import asyncio
import json

import anyio
import pytest
from fastapi.testclient import TestClient

from veille_reader import events
from veille_reader.chat import stream_turn
from veille_reader.server import create_app
from veille_reader.storage import ReaderStore

ITEMS = [
    {
        "id": "a1",
        "title": "A",
        "hook": "h",
        "url": "https://arxiv.org/abs/2401.01234",
        "type": "paper",
    }
]


def script(*steps):
    """A fake runner that yields the given events and records the requests it receives."""
    seen = []

    async def runner(request):
        seen.append(request)
        for step in steps:
            if isinstance(step, Exception):
                raise step
            yield step

    runner.seen = seen
    return runner


FULL = (
    events.thinking_delta("pondering "),
    events.thinking_delta("more"),
    events.tool_use("t1", "load_artifact", {"page_range": "1-2"}),
    events.tool_result("t1", "2 pages", False),
    events.text_delta("Hello "),
    events.text_delta("world [p.1]"),
    events.done(1234),
)


def make_client(tmp_path, runner):
    import json as _json

    cat = tmp_path / "c.json"
    cat.write_text(_json.dumps({"items": ITEMS}), encoding="utf-8")
    app = create_app(tmp_path / "data", cat, runner=runner)
    return TestClient(app, base_url="http://127.0.0.1:8765"), app


def parse(body: str) -> list[dict]:
    return [json.loads(line[6:]) for line in body.split("\n\n") if line.startswith("data: ")]


def new_conversation(client):
    return client.post("/api/items/a1/conversations", json={}).json()["id"]


def test_events_arrive_in_order_and_the_answer_is_stored(tmp_path):
    client, _ = make_client(tmp_path, script(*FULL))
    cid = new_conversation(client)
    response = client.post(
        f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [e["type"] for e in parse(response.text)] == [e["type"] for e in FULL]
    messages = client.get(f"/api/items/a1/conversations/{cid}/messages").json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    stored = messages[1]["content"]
    assert stored["answer"] == "Hello world [p.1]"
    assert stored["blocks"][0] == {"type": "thinking", "text": "pondering more"}
    assert stored["blocks"][1]["name"] == "load_artifact"
    assert stored["blocks"][1]["summary"] == "2 pages"
    assert stored["duration_ms"] == 1234 and stored["stopped"] is False


def test_a_runner_failure_gives_an_error_event_and_keeps_the_partial_answer(tmp_path):
    runner = script(events.text_delta("partial"), RuntimeError("boom"))
    client, _ = make_client(tmp_path, runner)
    cid = new_conversation(client)
    response = client.post(
        f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"}
    )
    last = parse(response.text)[-1]
    assert last["type"] == "error" and last["kind"] == "failed"
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]
    assert stored["answer"] == "partial"
    assert stored["error"]["kind"] == "failed"


def test_a_limit_event_is_passed_through_and_stored(tmp_path):
    runner = script(events.text_delta("x"), events.error("limit", "usage limit reached"))
    client, _ = make_client(tmp_path, runner)
    cid = new_conversation(client)
    response = client.post(
        f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"}
    )
    assert parse(response.text)[-1]["kind"] == "limit"
    assert (
        client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]["error"][
            "kind"
        ]
        == "limit"
    )


def test_closing_the_stream_early_stores_a_stopped_answer_and_closes_the_runner(tmp_path):
    closed = []

    async def runner(request):
        try:
            yield events.thinking_delta("t")
            yield events.text_delta("partial answer")
            await asyncio.sleep(10)
            yield events.done(1)
        finally:
            closed.append(True)

    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]

    async def go():
        stream = stream_turn(store, runner, ITEMS[0], cid, "text", {"text": "q"})
        first = await anext(stream)
        second = await anext(stream)
        await stream.aclose()
        return first, second

    first, second = asyncio.run(go())
    assert "thinking_delta" in first and "text_delta" in second
    assert closed == [True]
    stored = store.messages(cid)[1]["content"]
    assert stored["stopped"] is True and stored["answer"] == "partial answer"


def test_a_second_message_is_refused_while_the_first_streams(tmp_path):
    client, app = make_client(tmp_path, script(*FULL))
    cid = new_conversation(client)
    app.state.streaming.add(cid)
    busy = client.post(
        f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"}
    )
    assert busy.status_code == 409
    app.state.streaming.discard(cid)
    assert (
        client.post(
            f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"}
        ).status_code
        == 200
    )
    assert cid not in app.state.streaming  # released at the end of the stream


def test_regenerate_replaces_the_last_answer(tmp_path):
    runner = script(events.text_delta("first try"), events.done(1))
    client, _ = make_client(tmp_path, runner)
    cid = new_conversation(client)
    client.post(f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"})
    runner2 = script(events.text_delta("second try"), events.done(1))
    client.app.state.runner = runner2
    response = client.post(f"/api/items/a1/conversations/{cid}/regenerate")
    assert response.status_code == 200
    messages = client.get(f"/api/items/a1/conversations/{cid}/messages").json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["content"]["answer"] == "second try"
    assert runner2.seen[0].question == "Hi"


def test_regenerate_without_a_user_message_is_a_400(tmp_path):
    client, _ = make_client(tmp_path, script(*FULL))
    cid = new_conversation(client)
    assert client.post(f"/api/items/a1/conversations/{cid}/regenerate").status_code == 400


def test_ask_agent_stores_the_quote_and_the_runner_receives_it(tmp_path):
    runner = script(events.text_delta("ok"), events.done(1))
    client, _ = make_client(tmp_path, runner)
    cid = new_conversation(client)
    quote = {"text": "a passage", "page": 3, "rects": [[0, 0, 1, 1]]}
    client.post(
        f"/api/items/a1/conversations/{cid}/messages",
        json={"kind": "ask_agent", "quote": quote, "question": "why?"},
    )
    request = runner.seen[0]
    assert request.question == "why?" and request.quote["page"] == 3
    assert request.item["id"] == "a1"
    first = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[0]
    assert first["kind"] == "ask_agent" and first["content"]["quote"]["text"] == "a passage"


def test_history_is_passed_to_the_runner_in_order(tmp_path):
    runner = script(events.text_delta("one"), events.done(1))
    client, _ = make_client(tmp_path, runner)
    cid = new_conversation(client)
    client.post(f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "q1"})
    client.post(f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "q2"})
    history = runner.seen[1].history
    assert [(h["role"], h["text"]) for h in history] == [("user", "q1"), ("assistant", "one")]


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "text"},
        {"kind": "text", "text": ""},
        {"kind": "ask_agent", "question": "q"},
        {"kind": "ask_agent", "quote": {"text": "t", "page": 1, "rects": []}},
        {"kind": "other", "text": "x"},
        {"kind": "text", "text": "x" * 8001},
    ],
)
def test_invalid_messages_are_rejected(tmp_path, body):
    client, _ = make_client(tmp_path, script(*FULL))
    cid = new_conversation(client)
    assert client.post(f"/api/items/a1/conversations/{cid}/messages", json=body).status_code == 422
    assert client.get(f"/api/items/a1/conversations/{cid}/messages").json() == []


def test_unknown_conversation_and_cross_site(tmp_path):
    client, _ = make_client(tmp_path, script(*FULL))
    assert (
        client.post(
            "/api/items/a1/conversations/99/messages", json={"kind": "text", "text": "x"}
        ).status_code
        == 404
    )
    cid = new_conversation(client)
    blocked = client.post(
        f"/api/items/a1/conversations/{cid}/messages",
        json={"kind": "text", "text": "x"},
        headers={"Sec-Fetch-Site": "cross-site"},
    )
    assert blocked.status_code == 403


def test_cancelling_the_consuming_task_still_stores_the_partial_answer(tmp_path):
    """Browser Stop = the server task is cancelled (not a clean aclose)."""
    closed = []

    async def runner(request):
        try:
            yield events.text_delta("partial before stop")
            await asyncio.sleep(30)
            yield events.done(1)
        finally:
            closed.append(True)

    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]

    async def go():
        stream = stream_turn(store, runner, ITEMS[0], cid, "text", {"text": "q"})
        # a cancel scope is level-triggered like the server's: every later await is cancelled again
        with anyio.CancelScope() as scope:
            async for _line in stream:
                scope.cancel()

    anyio.run(go)
    stored = store.messages(cid)
    assert [m["role"] for m in stored] == ["user", "assistant"]
    assert stored[1]["content"]["stopped"] is True
    assert stored[1]["content"]["answer"] == "partial before stop"
    assert closed == [True]


def test_deleting_a_streaming_conversation_is_refused(tmp_path):
    client, app = make_client(tmp_path, script(*FULL))
    cid = new_conversation(client)
    app.state.streaming.add(cid)
    assert client.delete(f"/api/items/a1/conversations/{cid}").status_code == 409
    app.state.streaming.discard(cid)
    assert client.delete(f"/api/items/a1/conversations/{cid}").status_code == 204


def test_a_conversation_deleted_under_a_running_turn_does_not_crash(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    runner = script(events.text_delta("x"), events.done(1))

    async def go():
        stream = stream_turn(store, runner, ITEMS[0], cid, "text", {"text": "q"})
        await anext(stream)
        store.delete_conversation("a1", cid)
        async for _ in stream:
            pass

    asyncio.run(go())  # must not raise sqlite3.IntegrityError


def test_failure_messages_are_redacted(tmp_path):
    runner = script(RuntimeError("boom sk-ant-secret999"))
    client, _ = make_client(tmp_path, runner)
    cid = new_conversation(client)
    response = client.post(
        f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"}
    )
    assert "secret999" not in response.text


def test_the_cache_tokens_of_an_answer_reach_its_trace(tmp_path):
    usage = {"input_tokens": 1, "output_tokens": 2, "cost_usd": 0.1, "cache_read_tokens": 30}
    client, _ = make_client(tmp_path, script(events.text_delta("x"), events.done(5, usage)))
    cid = new_conversation(client)
    client.post(f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "Hi"})
    trace = client.get(f"/api/items/a1/conversations/{cid}/trace").json()[0]
    assert (trace["cache_read_tokens"], trace["cache_write_tokens"]) == (30, 0)


def _skill_client(tmp_path, runner):
    import json as _json

    cat = tmp_path / "c.json"
    cat.write_text(_json.dumps({"items": ITEMS}), encoding="utf-8")
    skills = tmp_path / "skills"
    skills.mkdir()
    (skills / "present.md").write_text(
        "---\nname: present\ndescription: Make slides.\ntools: [ask_user]\n---\nAsk then write."
    )
    app = create_app(tmp_path / "data", cat, runner=runner, skills_dir=skills)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_message_with_known_skill_forces_it(tmp_path):
    runner = script(events.done(1))
    client = _skill_client(tmp_path, runner)
    cid = new_conversation(client)
    client.post(
        f"/api/items/a1/conversations/{cid}/messages",
        json={"kind": "text", "text": "go", "skill": "present"},
    )
    request = runner.seen[0]
    assert request.skill.name == "present"
    assert [s.name for s in request.skills] == ["present"]


def test_message_with_unknown_skill_is_plain_text(tmp_path):
    runner = script(events.done(1))
    client = _skill_client(tmp_path, runner)
    cid = new_conversation(client)
    response = client.post(
        f"/api/items/a1/conversations/{cid}/messages",
        json={"kind": "text", "text": "go", "skill": "nope"},
    )
    assert response.status_code == 200
    assert runner.seen[0].skill is None


def test_message_with_malformed_skill_name_is_rejected(tmp_path):
    client = _skill_client(tmp_path, script(events.done(1)))
    cid = new_conversation(client)
    response = client.post(
        f"/api/items/a1/conversations/{cid}/messages",
        json={"kind": "text", "text": "go", "skill": "../x"},
    )
    assert response.status_code == 422
