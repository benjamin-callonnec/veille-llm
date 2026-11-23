import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from veille_reader import compaction, events
from veille_reader.compaction import (
    KEEP_RECENT,
    compact,
    current_history,
    needs_compaction,
)
from veille_reader.server import create_app
from veille_reader.storage import ReaderStore

from .pdf_factory import make_pdf

ITEM = {
    "id": "a1",
    "title": "A",
    "hook": "h",
    "url": "https://arxiv.org/abs/2401.01234",
    "type": "paper",
}


def fill(store, cid, count, size=300):
    """`count` question/answer pairs of about `size` characters each."""
    for i in range(count):
        store.add_message(cid, "user", "text", {"text": f"question {i} " + "q" * size})
        store.add_message(
            cid,
            "assistant",
            "assistant",
            {
                "answer": f"answer {i} " + "a" * size,
                "blocks": [],
                "duration_ms": 1,
                "stopped": False,
            },
        )


def test_without_a_compaction_the_whole_conversation_is_the_history(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 2)
    summary, turns = current_history(store.messages(cid))
    assert summary is None and len(turns) == 4
    assert [t["role"] for t in turns] == ["user", "assistant", "user", "assistant"]


def test_after_a_compaction_the_history_is_the_summary_and_what_came_later(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 3)
    upto = store.messages(cid)[3]["seq"]  # the first two pairs are summarised
    store.add_message(cid, "system", "compaction", {"summary": "old summary", "upto_seq": upto})
    fill(store, cid, 1)
    summary, turns = current_history(store.messages(cid))
    assert summary == "old summary"
    assert [t["text"][:10] for t in turns] == [
        "question 2",
        "answer 2 a",
        "question 0",
        "answer 0 a",
    ]


def test_only_the_latest_compaction_counts_and_system_messages_are_never_turns(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 2)
    store.add_message(cid, "system", "compaction", {"summary": "first", "upto_seq": 1})
    store.add_message(cid, "system", "compaction", {"summary": "second", "upto_seq": 3})
    summary, turns = current_history(store.messages(cid))
    assert summary == "second"
    assert len(turns) == 1 and turns[0]["role"] == "assistant"
    assert all(t["role"] in ("user", "assistant") for t in turns)


def test_compaction_is_needed_only_for_a_long_history(tmp_path, monkeypatch):
    monkeypatch.setattr(compaction, "COMPACT_AT", 500)
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 2, size=20)
    assert needs_compaction(current_history(store.messages(cid))[1]) is False
    fill(store, cid, 8, size=200)
    assert needs_compaction(current_history(store.messages(cid))[1]) is True


def test_a_long_history_with_few_exchanges_is_never_compacted(tmp_path, monkeypatch):
    monkeypatch.setattr(compaction, "COMPACT_AT", 100)
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, KEEP_RECENT, size=5000)
    assert needs_compaction(current_history(store.messages(cid))[1]) is False


def test_compact_summarises_all_but_the_recent_turns_and_stores_the_summary(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 6)
    seen = {}

    async def summarize(turns, previous):
        seen["turns"], seen["previous"] = turns, previous
        return "the summary"

    messages = store.messages(cid)
    stored = asyncio.run(compact(store, cid, messages, summarize))
    assert stored["kind"] == "compaction" and stored["role"] == "system"
    assert stored["content"]["summary"] == "the summary"
    assert len(seen["turns"]) == 2 * (6 - KEEP_RECENT) and seen["previous"] is None
    summary, turns = current_history(store.messages(cid))
    assert summary == "the summary" and len(turns) == 2 * KEEP_RECENT
    assert turns[0]["role"] == "user"  # an exchange is never cut in half
    assert turns[-1]["text"].startswith("answer 5")  # the latest turns are kept as they were


def test_a_second_compaction_builds_on_the_first(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 8)
    seen = []

    async def summarize(turns, previous):
        seen.append(previous)
        return f"summary {len(seen)}"

    asyncio.run(compact(store, cid, store.messages(cid), summarize))
    fill(store, cid, 8)
    asyncio.run(compact(store, cid, store.messages(cid), summarize))
    assert seen == [None, "summary 1"]
    assert current_history(store.messages(cid))[0] == "summary 2"


def test_a_failing_summary_changes_nothing_and_does_not_raise(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 8)

    async def broken(turns, previous):
        raise RuntimeError("model down")

    before = len(store.messages(cid))
    assert asyncio.run(compact(store, cid, store.messages(cid), broken)) is None
    assert len(store.messages(cid)) == before


def test_an_empty_summary_is_not_stored(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 8)

    async def blank(turns, previous):
        return "   "

    assert asyncio.run(compact(store, cid, store.messages(cid), blank)) is None


# --- in the chat flow ------------------------------------------------------------------------


def client_with(tmp_path, runner, summarizer):
    cat = tmp_path / "c.json"
    cat.write_text(json.dumps({"items": [ITEM]}), encoding="utf-8")
    app = create_app(
        tmp_path / "data",
        cat,
        runner=runner,
        fetch=lambda url: make_pdf(["page one"]),
        summarizer=summarizer,
    )
    return TestClient(app, base_url="http://127.0.0.1:8765")


def recording(*steps):
    seen = []

    async def runner(request):
        seen.append(request)
        for step in steps:
            yield step

    runner.seen = seen
    return runner


async def fake_summary(turns, previous):
    return "SUMMARY OF EARLIER"


def long_chat(client, monkeypatch):
    monkeypatch.setattr(compaction, "COMPACT_AT", 600)
    cid = client.post("/api/items/a1/conversations", json={}).json()["id"]
    fill(client.app.state.store, cid, 8, size=200)
    return cid


def send(client, cid, text="next question"):
    return client.post(
        f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": text}
    )


def test_a_long_conversation_is_compacted_before_the_model_is_called(tmp_path, monkeypatch):
    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, fake_summary)
    cid = long_chat(client, monkeypatch)
    client.post("/api/items/a1/memory", json={"text": "the user is a beginner"})
    send(client, cid)
    request = runner.seen[0]
    assert request.summary == "SUMMARY OF EARLIER"
    assert len(request.history) < 16  # the old turns are gone from the prompt
    assert request.notes == ["the user is a beginner"]  # pinned facts survive compaction
    kinds = [m["kind"] for m in client.get(f"/api/items/a1/conversations/{cid}/messages").json()]
    assert "compaction" in kinds and kinds[-1] == "assistant"


def test_a_short_conversation_is_left_alone(tmp_path):
    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, fake_summary)
    cid = client.post("/api/items/a1/conversations", json={}).json()["id"]
    send(client, cid)
    assert runner.seen[0].summary is None
    kinds = [m["kind"] for m in client.get(f"/api/items/a1/conversations/{cid}/messages").json()]
    assert "compaction" not in kinds


def test_a_summary_that_fails_does_not_block_the_answer(tmp_path, monkeypatch):
    async def broken(turns, previous):
        raise RuntimeError("down")

    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, broken)
    cid = long_chat(client, monkeypatch)
    response = send(client, cid)
    assert '"type": "done"' in response.text
    assert runner.seen[0].summary is None and len(runner.seen[0].history) == 16


def test_the_conversation_can_still_be_regenerated_after_a_compaction(tmp_path, monkeypatch):
    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, fake_summary)
    cid = long_chat(client, monkeypatch)
    send(client, cid)
    again = client.post(f"/api/items/a1/conversations/{cid}/regenerate")
    assert again.status_code == 200 and '"type": "done"' in again.text
    assert runner.seen[-1].question == "next question"


def test_the_export_skips_the_compaction_line(tmp_path, monkeypatch):
    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, fake_summary)
    cid = long_chat(client, monkeypatch)
    send(client, cid)
    md = client.get(f"/api/items/a1/conversations/{cid}/export").text
    assert "SUMMARY OF EARLIER" not in md and "next question" in md


@pytest.fixture(autouse=True)
def _restore():
    yield


def test_an_exchange_is_never_cut_in_half_even_when_the_newest_message_is_a_question(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 6)
    store.add_message(cid, "user", "text", {"text": "the current question"})  # no answer yet
    seen = {}

    async def summarize(turns, previous):
        seen["turns"] = turns
        return "s"

    asyncio.run(compact(store, cid, store.messages(cid), summarize))
    summary, turns = current_history(store.messages(cid))
    assert turns[0]["role"] == "user" and turns[-1]["text"] == "the current question"
    assert seen["turns"][-1]["role"] == "assistant"  # what was summarised ends on an answer
    assert sum(1 for t in turns if t["role"] == "user") == KEEP_RECENT


def test_a_tiny_amount_of_old_text_is_not_worth_a_summary(tmp_path, monkeypatch):
    monkeypatch.setattr(compaction, "COMPACT_AT", 100)
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 1, size=5)
    fill(store, cid, KEEP_RECENT, size=5000)  # the recent turns are the big ones
    called = []

    async def summarize(turns, previous):
        called.append(1)
        return "s"

    assert asyncio.run(compact(store, cid, store.messages(cid), summarize)) is None
    assert called == []


def test_a_slow_summary_gives_up_and_the_turn_goes_on(tmp_path, monkeypatch):
    monkeypatch.setattr(compaction, "SUMMARY_TIMEOUT", 0.05)
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 8)

    async def slow(turns, previous):
        await asyncio.sleep(5)
        return "late"

    assert asyncio.run(compact(store, cid, store.messages(cid), slow)) is None


def test_a_failed_summary_is_logged_without_any_of_the_text(tmp_path, caplog):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 8)

    async def broken(turns, previous):
        raise RuntimeError("model down")

    with caplog.at_level("WARNING"):
        asyncio.run(compact(store, cid, store.messages(cid), broken))
    assert any("summar" in r.getMessage().lower() for r in caplog.records)
    assert "question 0" not in caplog.text


def test_a_refused_turn_does_not_pay_for_a_summary(tmp_path, monkeypatch):
    called = []

    async def spy(turns, previous):
        called.append(1)
        return "s"

    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, spy)
    monkeypatch.setattr(compaction, "COMPACT_AT", 600)
    cid = client.post("/api/items/a1/conversations", json={}).json()["id"]
    store = client.app.state.store
    fill(store, cid, 8, size=200)
    store.add_trace(
        cid,
        duration_ms=1,
        tools=[],
        input_tokens=0,
        output_tokens=0,
        cost_usd=99.0,
        model="m",
        stopped=False,
        error_kind="",
    )
    response = send(client, cid)
    assert '"kind": "budget"' in response.text
    assert called == [] and runner.seen == []


def test_the_stream_announces_a_compaction(tmp_path, monkeypatch):
    runner = recording(events.text_delta("ok"), events.done(1))
    client = client_with(tmp_path, runner, fake_summary)
    cid = long_chat(client, monkeypatch)
    body = send(client, cid).text
    kinds = [json.loads(x[6:])["type"] for x in body.split("\n\n") if x.startswith("data: ")]
    assert kinds[0] == "compaction" and "done" in kinds


def test_stopping_during_the_compaction_leaves_a_stopped_answer_not_an_orphan(
    tmp_path, monkeypatch
):
    import anyio

    from veille_reader.chat import stream_turn

    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    monkeypatch.setattr(compaction, "COMPACT_AT", 600)
    fill(store, cid, 8, size=200)
    started = asyncio.Event() if False else None

    async def slow(turns, previous):
        await anyio.sleep(30)
        return "late"

    runner = recording(events.text_delta("never"), events.done(1))

    async def go():
        stream = stream_turn(
            store, runner, ITEM, cid, "text", {"text": "the question"}, summarizer=slow
        )
        with anyio.CancelScope() as scope:
            scope.cancel()  # Stop pressed while the old turns are being summarised
            async for _ in stream:
                pass

    anyio.run(go)
    last = [m for m in store.messages(cid) if m["role"] in ("user", "assistant")][-2:]
    assert [m["role"] for m in last] == ["user", "assistant"]
    assert last[1]["content"]["stopped"] is True
    del started
