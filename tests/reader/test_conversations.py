import json

import pytest
from fastapi.testclient import TestClient

from veille_reader.server import create_app

ITEMS = [
    {
        "id": "a1",
        "title": "A",
        "hook": "h",
        "url": "https://arxiv.org/abs/2401.01234",
        "type": "paper",
    },
    {"id": "b1", "title": "B", "hook": "h", "url": "https://example.org/p", "type": "news"},
]


@pytest.fixture
def client(tmp_path):
    cat = tmp_path / "c.json"
    cat.write_text(json.dumps({"items": ITEMS}), encoding="utf-8")
    return TestClient(create_app(tmp_path / "data", cat), base_url="http://127.0.0.1:8765")


def test_create_list_rename_delete(client):
    made = client.post("/api/items/a1/conversations", json={})
    assert made.status_code == 201
    cid = made.json()["id"]
    assert made.json()["title"] == "New conversation"
    assert (
        client.post("/api/items/a1/conversations", json={"title": "Second"}).json()["title"]
        == "Second"
    )
    assert [c["title"] for c in client.get("/api/items/a1/conversations").json()][0] == "Second"
    assert (
        client.patch(f"/api/items/a1/conversations/{cid}", json={"title": "Renamed"}).status_code
        == 200
    )
    assert client.get("/api/items/a1/conversations").json()[-1]["title"] == "Renamed"
    assert client.delete(f"/api/items/a1/conversations/{cid}").status_code == 204
    assert client.delete(f"/api/items/a1/conversations/{cid}").status_code == 404


def test_messages_and_export(client):
    cid = client.post("/api/items/a1/conversations", json={"title": "Chat"}).json()["id"]
    assert client.get(f"/api/items/a1/conversations/{cid}/messages").json() == []
    response = client.get(f"/api/items/a1/conversations/{cid}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert response.text.startswith("# Chat")


def test_unknown_item_or_conversation_is_404(client):
    assert client.get("/api/items/nope/conversations").status_code == 404
    assert client.post("/api/items/nope/conversations", json={}).status_code == 404
    assert client.get("/api/items/a1/conversations/999/messages").status_code == 404
    assert client.patch("/api/items/a1/conversations/999", json={"title": "x"}).status_code == 404
    assert client.get("/api/items/a1/conversations/999/export").status_code == 404


def test_another_items_conversation_is_not_reachable(client):
    cid = client.post("/api/items/a1/conversations", json={}).json()["id"]
    assert client.get(f"/api/items/b1/conversations/{cid}/messages").status_code == 404
    assert client.delete(f"/api/items/b1/conversations/{cid}").status_code == 404
    assert client.get(f"/api/items/a1/conversations/{cid}/messages").status_code == 200


def test_title_limits_and_cross_site_guard(client):
    assert client.post("/api/items/a1/conversations", json={"title": "x" * 201}).status_code == 422
    assert client.post("/api/items/a1/conversations", json={"title": ""}).status_code == 422
    blocked = client.post(
        "/api/items/a1/conversations", json={}, headers={"Sec-Fetch-Site": "cross-site"}
    )
    assert blocked.status_code == 403
    assert client.get("/api/items/a1/conversations").json() == []
