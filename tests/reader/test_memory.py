import json

import pytest
from fastapi.testclient import TestClient

from veille_reader.memory import MAX_NOTES, StoreMemory
from veille_reader.server import create_app
from veille_reader.storage import ReaderStore
from veille_reader.tools import ToolError

ITEMS = [
    {
        "id": "a1",
        "title": "A",
        "hook": "h",
        "url": "https://arxiv.org/abs/2401.01234",
        "type": "paper",
    },
    {
        "id": "b1",
        "title": "B",
        "hook": "h",
        "url": "https://arxiv.org/abs/2401.05678",
        "type": "paper",
    },
]


def test_notes_are_stored_per_paper(tmp_path):
    store = ReaderStore(tmp_path / "data")
    note = store.add_memory_note("a1", "the user is a beginner")
    store.add_memory_note("b1", "other paper")
    assert [n["text"] for n in store.memory_notes("a1")] == ["the user is a beginner"]
    assert store.memory_notes("a1")[0]["id"] == note["id"]
    assert store.update_memory_note("a1", note["id"], "the user knows RNNs") is True
    assert store.memory_notes("a1")[0]["text"] == "the user knows RNNs"
    assert store.update_memory_note("b1", note["id"], "x") is False  # not that paper's note
    assert store.delete_memory_note("b1", note["id"]) is False
    assert store.delete_memory_note("a1", note["id"]) is True
    assert store.memory_notes("a1") == []


def test_the_tutor_memory_enforces_the_note_limit(tmp_path):
    memory = StoreMemory(ReaderStore(tmp_path / "data"), "a1")
    for i in range(MAX_NOTES):
        memory.write(f"note {i}")
    with pytest.raises(ToolError, match="full"):
        memory.write("one too many")
    assert len(memory.read()) == MAX_NOTES
    first = memory.read()[0]["id"]
    assert memory.delete(first) is True and memory.delete(first) is False
    memory.write("room again")


def test_the_tutor_memory_only_sees_its_own_paper(tmp_path):
    store = ReaderStore(tmp_path / "data")
    StoreMemory(store, "b1").write("secret of b1")
    assert StoreMemory(store, "a1").read() == []
    assert StoreMemory(store, "a1").delete(store.memory_notes("b1")[0]["id"]) is False


@pytest.fixture
def client(tmp_path):
    cat = tmp_path / "c.json"
    cat.write_text(json.dumps({"items": ITEMS}), encoding="utf-8")
    return TestClient(create_app(tmp_path / "data", cat), base_url="http://127.0.0.1:8765")


def test_the_user_can_list_add_edit_and_delete_notes(client):
    assert client.get("/api/items/a1/memory").json() == []
    made = client.post("/api/items/a1/memory", json={"text": "prefers short answers"})
    assert made.status_code == 201
    nid = made.json()["id"]
    assert client.get("/api/items/a1/memory").json()[0]["text"] == "prefers short answers"
    edited = client.put(f"/api/items/a1/memory/{nid}", json={"text": "prefers detailed answers"})
    assert edited.status_code == 200 and edited.json()["text"] == "prefers detailed answers"
    assert client.delete(f"/api/items/a1/memory/{nid}").status_code == 204
    assert client.delete(f"/api/items/a1/memory/{nid}").status_code == 404


def test_notes_are_validated(client):
    for bad in ({"text": ""}, {"text": "   "}, {"text": "x" * 501}, {}):
        assert client.post("/api/items/a1/memory", json=bad).status_code == 422
    assert client.get("/api/items/a1/memory").json() == []


def test_the_note_limit_is_a_conflict(client):
    for i in range(MAX_NOTES):
        assert client.post("/api/items/a1/memory", json={"text": f"n{i}"}).status_code == 201
    assert client.post("/api/items/a1/memory", json={"text": "extra"}).status_code == 409


def test_unknown_items_and_other_papers_notes_are_not_reachable(client):
    assert client.get("/api/items/nope/memory").status_code == 404
    assert client.post("/api/items/nope/memory", json={"text": "x"}).status_code == 404
    nid = client.post("/api/items/a1/memory", json={"text": "mine"}).json()["id"]
    assert client.put(f"/api/items/b1/memory/{nid}", json={"text": "x"}).status_code == 404
    assert client.delete(f"/api/items/b1/memory/{nid}").status_code == 404
    assert client.get("/api/items/a1/memory").json()[0]["text"] == "mine"


def test_notes_cannot_be_changed_from_another_site(client):
    cross = {"Sec-Fetch-Site": "cross-site"}
    assert client.post("/api/items/a1/memory", json={"text": "x"}, headers=cross).status_code == 403
    assert client.get("/api/items/a1/memory").json() == []


def test_a_note_says_who_wrote_it(tmp_path):
    store = ReaderStore(tmp_path / "data")
    StoreMemory(store, "a1").write("written by the tutor")
    store.add_memory_note("a1", "written by the user")
    sources = {n["text"]: n["source"] for n in store.memory_notes("a1")}
    assert sources == {"written by the tutor": "tutor", "written by the user": "user"}


def test_the_api_shows_the_source_and_a_user_note_is_marked_as_the_users(client):
    made = client.post("/api/items/a1/memory", json={"text": "mine"}).json()
    assert made["source"] == "user"
    assert client.get("/api/items/a1/memory").json()[0]["source"] == "user"
