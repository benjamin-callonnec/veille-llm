import json

from fastapi.testclient import TestClient

from veille_reader import events
from veille_reader.limits import AgentLimits
from veille_reader.paper import PaperText
from veille_reader.server import create_app
from veille_reader.storage import ReaderStore
from veille_reader.tools import PaperTools

from .pdf_factory import make_pdf

ITEMS = [
    {
        "id": "a1",
        "title": "A",
        "hook": "h",
        "url": "https://arxiv.org/abs/2401.01234",
        "type": "paper",
    },
    {"id": "n1", "title": "N", "hook": "h", "url": "https://example.org/post", "type": "news"},
]
PDF = make_pdf(["Attention page one", "Second page about heads"], [("Intro", 1)])


def recording(*steps):
    seen = []

    async def runner(request):
        seen.append(request)
        for step in steps:
            yield step

    runner.seen = seen
    return runner


ANSWER = (
    events.text_delta("ok"),
    events.done(5, {"input_tokens": 1, "output_tokens": 2, "cost_usd": 0.1}),
)


def client_for(tmp_path, runner, **kw):
    cat = tmp_path / "c.json"
    cat.write_text(json.dumps({"items": ITEMS}), encoding="utf-8")
    kw.setdefault("fetch", lambda url: PDF)
    app = create_app(tmp_path / "data", cat, runner=runner, **kw)
    return TestClient(app, base_url="http://127.0.0.1:8765"), app


def conv(client, item="a1"):
    return client.post(f"/api/items/{item}/conversations", json={}).json()["id"]


def send(client, cid, text="Hi", item="a1", **extra):
    return client.post(
        f"/api/items/{item}/conversations/{cid}/messages",
        json={"kind": "text", "text": text, **extra},
    )


def types(response):
    return [
        json.loads(x[6:])["type"] for x in response.text.split("\n\n") if x.startswith("data: ")
    ]


def test_the_runner_gets_the_papers_tools_built_from_the_cached_pdf(tmp_path):
    runner = recording(*ANSWER)
    client, _ = client_for(tmp_path, runner)
    send(client, conv(client))
    tools = runner.seen[0].paper_tools
    assert isinstance(tools, PaperTools)
    assert "Attention page one" in tools.paper.pages[0]
    assert tools.paper.outline == [("Intro", 1)]


def test_the_notes_and_the_users_highlights_are_given_to_the_tutor(tmp_path):
    runner = recording(*ANSWER)
    client, _ = client_for(tmp_path, runner)
    client.post("/api/items/a1/memory", json={"text": "the user is a beginner"})
    client.post(
        "/api/items/a1/highlights",
        json={"page": 1, "color": "red", "text": "hard part", "rects": [[0, 0, 1, 1]]},
    )
    send(client, conv(client))
    request = runner.seen[0]
    assert request.notes == ["the user is a beginner"]
    assert request.paper_tools.highlights[0]["text"] == "hard part"
    # the tool the tutor uses to write notes writes into the same store the user edits
    request.paper_tools.session_memory("write", text="knows RNNs")
    assert [n["text"] for n in client.get("/api/items/a1/memory").json()] == [
        "the user is a beginner",
        "knows RNNs",
    ]


def test_without_a_pdf_the_answer_still_streams_with_no_tools(tmp_path):
    runner = recording(*ANSWER)
    client, _ = client_for(tmp_path, runner)
    response = send(client, conv(client, "n1"), item="n1")
    assert types(response) == ["text_delta", "done"]
    assert runner.seen[0].paper_tools is None


def test_a_failing_download_does_not_stop_the_chat(tmp_path):
    runner = recording(*ANSWER)

    def broken(url):
        raise OSError("offline")

    client, _ = client_for(tmp_path, runner, fetch=broken)
    response = send(client, conv(client))
    assert types(response) == ["text_delta", "done"]
    assert runner.seen[0].paper_tools is None


def test_a_custom_tools_factory_is_used_when_given(tmp_path):
    runner = recording(*ANSWER)
    fake = PaperTools(PaperText(pages=["x"], outline=[]), [], memory=None)
    client, _ = client_for(tmp_path, runner, tools_factory=lambda item_id, item: (fake, ["n"]))
    send(client, conv(client))
    assert runner.seen[0].paper_tools is fake and runner.seen[0].notes == ["n"]


def test_the_agent_limits_reach_the_runner(tmp_path):
    runner = recording(*ANSWER)
    limits = AgentLimits(max_turns=3, max_message_usd=0.2, max_session_usd=1.0)
    client, _ = client_for(tmp_path, runner, agent_limits=limits)
    send(client, conv(client))
    assert runner.seen[0].agent_limits == limits


def test_the_usage_of_an_answer_is_stored_with_it(tmp_path):
    client, _ = client_for(tmp_path, recording(*ANSWER))
    cid = conv(client)
    send(client, cid)
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]
    assert stored["usage"] == {"input_tokens": 1, "output_tokens": 2, "cost_usd": 0.1}


# --- trace -----------------------------------------------------------------------------------


TOOLED = (
    events.thinking_delta("hm"),
    events.tool_use("t1", "search_paper", {"query": "heads"}),
    events.tool_result("t1", "1 results", False),
    events.tool_use("t2", "load_artifact", {"kind": "pages", "start": 9, "end": 9}),
    events.tool_result("t2", "page 9 is out of range", True),
    events.text_delta("answer"),
    events.done(1200, {"input_tokens": 100, "output_tokens": 50, "cost_usd": 0.02}),
)


def test_every_turn_leaves_a_local_trace(tmp_path):
    client, _ = client_for(tmp_path, recording(*TOOLED), model="claude-sonnet-5-5")
    cid = conv(client)
    send(client, cid)
    trace = client.get(f"/api/items/a1/conversations/{cid}/trace").json()
    assert len(trace) == 1
    turn = trace[0]
    assert [t["name"] for t in turn["tools"]] == ["search_paper", "load_artifact"]
    assert [t["is_error"] for t in turn["tools"]] == [False, True]
    assert all(isinstance(t["duration_ms"], int) for t in turn["tools"])
    assert turn["input_tokens"] == 100 and turn["output_tokens"] == 50 and turn["cost_usd"] == 0.02
    assert turn["model"] == "claude-sonnet-5-5" and turn["stopped"] is False
    assert turn["duration_ms"] >= 0


def test_the_trace_never_contains_the_text_of_the_paper_or_the_question(tmp_path):
    client, _ = client_for(tmp_path, recording(*TOOLED))
    cid = conv(client)
    send(client, cid, text="a very private question")
    body = client.get(f"/api/items/a1/conversations/{cid}/trace").text
    assert "a very private question" not in body and "answer" not in body.replace("answers", "")


def test_a_failed_turn_is_traced_with_its_error_kind(tmp_path):
    client, _ = client_for(tmp_path, recording(events.error("limit", "usage limit")))
    cid = conv(client)
    send(client, cid)
    turn = client.get(f"/api/items/a1/conversations/{cid}/trace").json()[0]
    assert turn["error_kind"] == "limit"


def test_the_trace_belongs_to_its_paper(tmp_path):
    client, _ = client_for(tmp_path, recording(*ANSWER))
    cid = conv(client)
    send(client, cid)
    assert client.get(f"/api/items/n1/conversations/{cid}/trace").status_code == 404
    assert client.get("/api/items/a1/conversations/999/trace").status_code == 404


# --- session limit ---------------------------------------------------------------------------


def over_limit(client, cid, spent=1.2):
    """Make the conversation look like it already cost `spent` USD (the trace is what counts)."""
    store: ReaderStore = client.app.state.store
    store.add_message(cid, "user", "text", {"text": "earlier"})
    store.add_message(
        cid,
        "assistant",
        "assistant",
        {"answer": "x", "blocks": [], "duration_ms": 1, "stopped": False},
    )
    store.add_trace(
        cid,
        duration_ms=1,
        tools=[],
        input_tokens=0,
        output_tokens=0,
        cost_usd=spent,
        model="m",
        stopped=False,
        error_kind="",
    )


def tight(tmp_path, runner):
    return client_for(tmp_path, runner, agent_limits=AgentLimits(max_session_usd=1.0))


def test_a_conversation_over_its_budget_is_refused_without_calling_the_model(tmp_path):
    runner = recording(*ANSWER)
    client, _ = tight(tmp_path, runner)
    cid = conv(client)
    over_limit(client, cid)
    response = send(client, cid)
    assert types(response) == ["error"]
    assert runner.seen == []
    message = json.loads(response.text.split("\n\n")[0][6:])
    assert message["kind"] == "limit" and "conversation" in message["message"].lower()
    # the refusal is kept in the conversation like any other answer
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()
    assert stored[-1]["content"]["error"]["kind"] == "limit"


def test_the_limit_can_be_raised_once_per_conversation(tmp_path):
    runner = recording(*ANSWER)
    client, _ = tight(tmp_path, runner)
    cid = conv(client)
    over_limit(client, cid, spent=1.2)
    ok = send(client, cid, raise_limit=True)
    assert types(ok) == ["text_delta", "done"] and len(runner.seen) == 1
    over_limit(client, cid, spent=2.5)  # past even the raised limit of 2.0
    again = send(client, cid, raise_limit=True)
    assert types(again) == ["error"] and len(runner.seen) == 1
    assert "already" in json.loads(again.text.split("\n\n")[0][6:])["message"].lower()


def test_raising_the_limit_when_under_it_does_not_use_up_the_raise(tmp_path):
    runner = recording(*ANSWER)
    client, _ = tight(tmp_path, runner)
    cid = conv(client)
    assert types(send(client, cid, raise_limit=True)) == ["text_delta", "done"]
    over_limit(client, cid, spent=1.2)
    assert types(send(client, cid, raise_limit=True)) == ["text_delta", "done"]


def test_a_conversation_under_its_budget_is_not_touched(tmp_path):
    runner = recording(*ANSWER)
    client, _ = tight(tmp_path, runner)
    cid = conv(client)
    over_limit(client, cid, spent=0.4)
    assert types(send(client, cid)) == ["text_delta", "done"]


COSTLY = (
    events.text_delta("ok"),
    events.done(5, {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.6}),
)


def test_an_answer_that_hits_a_limit_still_costs_what_the_sdk_reported(tmp_path):
    hit = recording(
        events.error(
            "limit", "too many steps", {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.5}
        )
    )
    client, _ = client_for(tmp_path, hit, agent_limits=AgentLimits(max_session_usd=1.0))
    cid = conv(client)
    send(client, cid)
    assert client.get(f"/api/items/a1/conversations/{cid}/trace").json()[0]["cost_usd"] == 0.5
    send(client, cid)  # a second capped answer: 1.0 in total
    refused = send(client, cid)
    assert types(refused) == ["error"] and len(hit.seen) == 2


def test_regenerating_does_not_erase_what_the_conversation_already_cost(tmp_path):
    runner = recording(*COSTLY)
    client, _ = client_for(tmp_path, runner, agent_limits=AgentLimits(max_session_usd=1.0))
    cid = conv(client)
    send(client, cid)  # 0.6
    send(client, cid)  # 1.2: allowed because 0.6 < 1.0
    again = client.post(f"/api/items/a1/conversations/{cid}/regenerate")
    assert types(again) == ["error"]  # the cost of the deleted answer still counts
    assert len(runner.seen) == 2


def test_the_session_cost_is_the_sum_of_the_traces(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    for cost in (0.25, 0.5, 0.0):
        store.add_trace(
            cid,
            duration_ms=1,
            tools=[],
            input_tokens=0,
            output_tokens=0,
            cost_usd=cost,
            model="m",
            stopped=False,
            error_kind="",
        )
    assert store.session_cost(cid) == 0.75
    assert store.session_cost(999) == 0.0


# --- citations are checked against the paper -------------------------------------------------

CITED = (
    events.text_delta('It reaches that [p.1 "attention page one"] and also '),
    events.text_delta('[p.2 "a totally invented sentence"].'),
    events.done(5),
)


def event_list(response):
    return [json.loads(x[6:]) for x in response.text.split("\n\n") if x.startswith("data: ")]


def test_citations_are_checked_before_the_answer_ends(tmp_path):
    client, _ = client_for(tmp_path, recording(*CITED))
    response = send(client, conv(client))
    kinds = types(response)
    assert kinds == [
        "text_delta",
        "text_delta",
        "citations",
        "done",
    ]  # the check comes just before done
    items = event_list(response)[2]["items"]
    assert [(i["page"], i["status"]) for i in items] == [(1, "verified"), (2, "unverified")]
    assert items[0]["section"] == "Intro" and items[0]["quote"] == "attention page one"


def test_the_checked_citations_are_stored_with_the_answer(tmp_path):
    client, _ = client_for(tmp_path, recording(*CITED))
    cid = conv(client)
    send(client, cid)
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]
    assert [c["status"] for c in stored["citations"]] == ["verified", "unverified"]


def test_an_answer_that_fails_halfway_still_stores_its_checked_citations(tmp_path):
    runner = recording(
        events.text_delta('Partly [p.1 "attention page one"]'), events.error("limit", "x")
    )
    client, _ = client_for(tmp_path, runner)
    cid = conv(client)
    response = send(client, cid)
    assert "citations" not in types(response)  # nothing to announce: the answer did not finish
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]
    assert stored["citations"][0]["status"] == "verified"


def test_there_is_nothing_to_check_without_citations_or_without_the_paper(tmp_path):
    plain = recording(events.text_delta("no citation here"), events.done(1))
    client, _ = client_for(tmp_path, plain)
    cid = conv(client)
    assert "citations" not in types(send(client, cid))
    assert (
        "citations"
        not in client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]
    )
    cited = recording(*CITED)
    (tmp_path / "other").mkdir()
    news_client, _ = client_for(tmp_path / "other", cited)
    news = conv(news_client, "n1")
    response = send(news_client, news, item="n1")
    assert "citations" not in types(response)  # a news item has no paper to check against
