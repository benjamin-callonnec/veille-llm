import json

import pytest
from fastapi.testclient import TestClient

from veille_reader.server import create_app

PDF = b"%PDF-1.7\nbody"
ITEMS = [
    {
        "id": "a1",
        "title": "A paper",
        "hook": "Why it matters",
        "url": "https://arxiv.org/abs/2401.01234",
        "type": "paper",
    },
    {
        "id": "b1",
        "title": "A blog",
        "hook": "News",
        "url": "https://example.org/post",
        "type": "news",
    },
]


@pytest.fixture
def catalogue(tmp_path):
    path = tmp_path / "catalogue.json"
    path.write_text(json.dumps({"items": ITEMS}), encoding="utf-8")
    return path


@pytest.fixture
def calls():
    return []


@pytest.fixture
def client(tmp_path, catalogue, calls):
    def fetch(url):
        calls.append(url)
        return PDF

    app = create_app(tmp_path / "data", catalogue, fetch=fetch)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_item_metadata_and_has_pdf(client):
    paper = client.get("/api/items/a1").json()
    assert paper == {
        "id": "a1",
        "title": "A paper",
        "hook": "Why it matters",
        "url": "https://arxiv.org/abs/2401.01234",
        "type": "paper",
        "has_pdf": True,
    }
    assert client.get("/api/items/b1").json()["has_pdf"] is False


def test_unknown_item_is_404(client):
    assert client.get("/api/items/nope").status_code == 404
    assert client.get("/api/items/nope/pdf").status_code == 404


def test_pdf_is_served_and_fetched_once(client, calls):
    first = client.get("/api/items/a1/pdf")
    second = client.get("/api/items/a1/pdf")
    assert first.status_code == 200
    assert first.headers["content-type"] == "application/pdf"
    assert first.content == second.content == PDF
    assert len(calls) == 1


def test_blog_has_no_pdf(client):
    response = client.get("/api/items/b1/pdf")
    assert response.status_code == 404
    assert response.json() == {"reason": "no_pdf"}


def test_fetch_failure_is_502(tmp_path, catalogue):
    def fetch(url):
        raise OSError("down")

    app = create_app(tmp_path / "data", catalogue, fetch=fetch)
    c = TestClient(app, base_url="http://127.0.0.1:8765")
    response = c.get("/api/items/a1/pdf")
    assert response.status_code == 502
    assert response.json() == {"reason": "fetch_failed"}


def test_non_local_host_is_refused(client):
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 403
    assert client.get("/api/health", headers={"Host": "localhost:8765"}).status_code == 200


def test_path_tricks_never_leave_data_dir(client, tmp_path):
    for item_id in ("..%2f..%2fx", "%2e%2e", "../../x"):
        assert client.get(f"/api/items/{item_id}/pdf").status_code == 404
    assert {p.name for p in tmp_path.iterdir()} <= {"data", "catalogue.json"}


def test_catalogue_is_served(client):
    assert client.get("/catalogue.json").json()["items"][0]["id"] == "a1"


def test_static_files_are_served(tmp_path, catalogue):
    static = tmp_path / "dist"
    static.mkdir()
    (static / "reader.html").write_text("<p>reader</p>", encoding="utf-8")
    app = create_app(tmp_path / "data", catalogue, static_dir=static)
    c = TestClient(app, base_url="http://127.0.0.1:8765")
    assert "reader" in c.get("/reader.html").text
    assert c.get("/api/health").status_code == 200


def test_missing_catalogue_is_a_clear_error(tmp_path):
    with pytest.raises(ValueError, match="catalogue"):
        create_app(tmp_path / "data", tmp_path / "missing.json")


def test_invalid_catalogue_is_a_clear_error(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError, match="catalogue"):
        create_app(tmp_path / "data", bad)


def test_cross_site_requests_are_refused(client, calls):
    cross = {"Sec-Fetch-Site": "cross-site"}
    assert client.get("/api/items/a1/pdf", headers=cross).status_code == 403
    assert (
        client.get("/api/items/a1/pdf", headers={"Sec-Fetch-Site": "same-site"}).status_code == 403
    )
    assert (
        client.get("/api/items/a1/pdf", headers={"Origin": "https://evil.example"}).status_code
        == 403
    )
    assert calls == []


def test_same_origin_requests_are_accepted(client):
    assert client.get("/api/health", headers={"Sec-Fetch-Site": "same-origin"}).status_code == 200
    assert client.get("/api/health", headers={"Sec-Fetch-Site": "none"}).status_code == 200
    assert client.get("/api/health", headers={"Origin": "http://127.0.0.1:8765"}).status_code == 200


def test_responses_forbid_framing_and_cross_origin_reads(client):
    response = client.get("/api/health")
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert response.headers["cross-origin-resource-policy"] == "same-origin"


def test_items_must_be_a_list(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('{"items": {"a": 1}}', encoding="utf-8")
    with pytest.raises(ValueError, match="catalogue"):
        create_app(tmp_path / "data", bad)


def test_catalogue_changes_are_picked_up(client, catalogue):
    import os

    assert client.get("/api/items/new1").status_code == 404
    fresh = {
        "items": [*ITEMS, {"id": "new1", "title": "N", "hook": "h", "url": "u", "type": "paper"}]
    }
    catalogue.write_text(json.dumps(fresh), encoding="utf-8")
    stat = catalogue.stat()
    os.utime(catalogue, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10**9))
    assert client.get("/api/items/new1").status_code == 200


def test_ipv6_literal_is_not_a_local_host(client):
    assert client.get("/api/health", headers={"Host": "[::1]:8765"}).status_code == 403


HL = {"page": 2, "color": "yellow", "text": "a passage", "rects": [[0.1, 0.2, 0.3, 0.05]]}


def test_highlights_post_get_delete(client):
    created = client.post("/api/items/a1/highlights", json=HL)
    assert created.status_code == 201
    body = created.json()
    assert body["page"] == 2 and body["color"] == "yellow" and body["rects"] == HL["rects"]
    assert client.get("/api/items/a1/highlights").json() == [body]
    assert client.delete(f"/api/items/a1/highlights/{body['id']}").status_code == 204
    assert client.get("/api/items/a1/highlights").json() == []
    assert client.delete(f"/api/items/a1/highlights/{body['id']}").status_code == 404


def test_highlights_unknown_item_is_404(client):
    assert client.get("/api/items/nope/highlights").status_code == 404
    assert client.post("/api/items/nope/highlights", json=HL).status_code == 404


@pytest.mark.parametrize(
    "patch",
    [
        {"color": "blue"},
        {"page": 0},
        {"text": "x" * 5001},
        {"rects": [[0, 0, 1, 1]] * 201},
        {"rects": [[0, 0, 1.5, 1]]},
        {"rects": [[-0.1, 0, 1, 1]]},
        {"rects": [[0, 0, 1]]},
    ],
)
def test_invalid_highlights_are_rejected_and_not_stored(client, patch):
    assert client.post("/api/items/a1/highlights", json={**HL, **patch}).status_code == 422
    assert client.get("/api/items/a1/highlights").json() == []


def test_cross_site_highlight_post_is_refused(client):
    response = client.post(
        "/api/items/a1/highlights", json=HL, headers={"Sec-Fetch-Site": "cross-site"}
    )
    assert response.status_code == 403
    assert client.get("/api/items/a1/highlights").json() == []


def test_delete_cannot_reach_another_items_highlight(client):
    hid = client.post("/api/items/a1/highlights", json=HL).json()["id"]
    assert client.delete(f"/api/items/b1/highlights/{hid}").status_code == 404
    assert len(client.get("/api/items/a1/highlights").json()) == 1
