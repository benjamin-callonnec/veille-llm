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


def fill(store, cid, count, size=50):
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
    fill(store, cid, 6, size=100)
    assert needs_compaction(current_history(store.messages(cid))[1]) is True


def test_a_long_history_with_few_turns_is_never_compacted(tmp_path, monkeypatch):
    monkeypatch.setattr(compaction, "COMPACT_AT", 100)
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 1, size=5000)
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
    assert len(seen["turns"]) == 12 - KEEP_RECENT and seen["previous"] is None
    summary, turns = current_history(store.messages(cid))
    assert summary == "the summary" and len(turns) == KEEP_RECENT
    assert turns[-1]["text"].startswith("answer 5")  # the latest turns are kept as they were


def test_a_second_compaction_builds_on_the_first(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 6)
    seen = []

    async def summarize(turns, previous):
        seen.append(previous)
        return f"summary {len(seen)}"

    asyncio.run(compact(store, cid, store.messages(cid), summarize))
    fill(store, cid, 6)
    asyncio.run(compact(store, cid, store.messages(cid), summarize))
    assert seen == [None, "summary 1"]
    assert current_history(store.messages(cid))[0] == "summary 2"


def test_a_failing_summary_changes_nothing_and_does_not_raise(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 6)

    async def broken(turns, previous):
        raise RuntimeError("model down")

    before = len(store.messages(cid))
    assert asyncio.run(compact(store, cid, store.messages(cid), broken)) is None
    assert len(store.messages(cid)) == before


def test_an_empty_summary_is_not_stored(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    fill(store, cid, 6)

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
    fill(client.app.state.store, cid, 6, size=100)
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
    assert len(request.history) < 12  # the old turns are gone from the prompt
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
    assert runner.seen[0].summary is None and len(runner.seen[0].history) == 12


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
