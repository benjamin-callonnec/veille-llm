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
    assert client.get("/api/health", headers={"Host": "[::1]:8765"}).status_code == 200


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
