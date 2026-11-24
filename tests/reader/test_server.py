import json
import os

import pytest
from fastapi.testclient import TestClient

from veille_reader.server import create_app

from .pdf_factory import make_pdf

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


def test_dev_front_origin_is_accepted_only_when_configured(tmp_path, catalogue):
    plain = TestClient(create_app(tmp_path / "d1", catalogue), base_url="http://127.0.0.1:8765")
    dev = TestClient(
        create_app(tmp_path / "d2", catalogue, dev_origins={"http://127.0.0.1:5173"}),
        base_url="http://127.0.0.1:8765",
    )
    body = {"title": "t"}
    headers = {"Origin": "http://127.0.0.1:5173"}
    assert plain.post("/api/items/a1/conversations", json=body, headers=headers).status_code == 403
    assert dev.post("/api/items/a1/conversations", json=body, headers=headers).status_code == 201
    other = {"Origin": "https://evil.example"}
    assert dev.post("/api/items/a1/conversations", json=body, headers=other).status_code == 403


def test_dev_front_redirects_the_pages_to_the_hot_reload_server(tmp_path, catalogue):
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<p>old build</p>", encoding="utf-8")
    (static / "reader.html").write_text("<p>old reader</p>", encoding="utf-8")
    app = create_app(
        tmp_path / "d", catalogue, static_dir=static, dev_front="http://127.0.0.1:5173"
    )
    client = TestClient(app, base_url="http://127.0.0.1:8765", follow_redirects=False)
    for path, target in (
        ("/", "http://127.0.0.1:5173/"),
        ("/index.html", "http://127.0.0.1:5173/"),
        ("/reader.html", "http://127.0.0.1:5173/reader.html"),
    ):
        response = client.get(path)
        assert response.status_code == 307, path
        assert response.headers["location"] == target, path
    assert client.get("/api/health").status_code == 200  # the API itself is never redirected
    assert client.get("/catalogue.json").status_code == 200


def test_without_dev_front_the_static_pages_are_served_as_before(tmp_path, catalogue):
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<p>the build</p>", encoding="utf-8")
    app = create_app(tmp_path / "d", catalogue, static_dir=static)
    client = TestClient(app, base_url="http://127.0.0.1:8765", follow_redirects=False)
    response = client.get("/")
    assert response.status_code == 200 and "the build" in response.text


def test_the_redirect_target_cannot_be_influenced_by_the_request(tmp_path, catalogue):
    app = create_app(tmp_path / "d", catalogue, dev_front="http://127.0.0.1:5173")
    client = TestClient(app, base_url="http://127.0.0.1:8765", follow_redirects=False)
    response = client.get(
        "/?next=https://evil.example", headers={"Referer": "https://evil.example"}
    )
    assert response.headers["location"] == "http://127.0.0.1:5173/"


def test_health_names_the_model_only_when_the_server_was_given_one(tmp_path, catalogue):
    plain = TestClient(create_app(tmp_path / "d1", catalogue), base_url="http://127.0.0.1:8765")
    assert plain.get("/api/health").json() == {"status": "ok"}
    named = TestClient(
        create_app(tmp_path / "d2", catalogue, model="claude-sonnet-5-5"),
        base_url="http://127.0.0.1:8765",
    )
    assert named.get("/api/health").json() == {"status": "ok", "model": "claude-sonnet-5-5"}


def structure_client(tmp_path, catalogue, body):
    app = create_app(tmp_path / "data", catalogue, fetch=lambda url: body)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_structure_of_a_paper(tmp_path, catalogue):
    client = structure_client(tmp_path, catalogue, make_pdf(["Figure 1: A figure"]))
    response = client.get("/api/items/a1/structure")
    assert response.status_code == 200
    body = response.json()
    assert [(c["kind"], c["number"], c["page"]) for c in body["captions"]] == [("figure", "1", 1)]
    assert len(body["captions"][0]["rect"]) == 4


def test_structure_of_an_unknown_item_is_404(client):
    response = client.get("/api/items/nope/structure")
    assert response.status_code == 404
    assert response.json() == {"reason": "unknown_item"}


def test_structure_of_an_unreadable_pdf_is_404_and_the_reader_still_works(tmp_path, catalogue):
    client = structure_client(tmp_path, catalogue, b"%PDF-1.7\nnot a real pdf")
    response = client.get("/api/items/a1/structure")
    assert response.status_code == 404
    assert response.json() == {"reason": "no_structure"}
    assert client.get("/api/items/a1").status_code == 200


def test_structure_of_a_paper_without_pdf_is_404(client):
    response = client.get("/api/items/b1/structure")
    assert response.status_code == 404
    assert response.json() == {"reason": "no_pdf"}


def test_favorites_start_empty_and_keep_a_copy_of_the_catalogue_item(client):
    assert client.get("/api/favorites").json() == []
    assert client.put("/api/favorites/b1").status_code == 204
    (fav,) = client.get("/api/favorites").json()
    assert fav["item_id"] == "b1" and fav["item"] == ITEMS[1] and fav["added_at"]


def test_adding_a_favorite_twice_keeps_one_entry_and_its_first_date(client):
    client.put("/api/favorites/a1")
    first = client.get("/api/favorites").json()
    client.put("/api/favorites/a1")
    assert client.get("/api/favorites").json() == first


def test_only_catalogue_items_can_become_favorites(client):
    assert client.put("/api/favorites/nope").status_code == 404
    assert client.get("/api/favorites").json() == []


def test_removing_a_favorite_is_idempotent(client):
    client.put("/api/favorites/a1")
    assert client.delete("/api/favorites/a1").status_code == 204
    assert client.delete("/api/favorites/a1").status_code == 204
    assert client.get("/api/favorites").json() == []


def test_favorites_are_listed_newest_first_and_survive_the_item_leaving_the_catalogue(
    client, catalogue
):
    client.put("/api/favorites/a1")
    client.put("/api/favorites/b1")
    catalogue.write_text(json.dumps({"items": []}), encoding="utf-8")
    os.utime(catalogue, ns=(1, 1))  # a new mtime: the server reloads the catalogue
    assert [f["item_id"] for f in client.get("/api/favorites").json()] == ["b1", "a1"]
    assert client.get("/api/favorites").json()[1]["item"]["title"] == "A paper"


def test_a_github_item_with_a_slash_in_its_id_can_be_a_favorite(tmp_path, calls):
    path = tmp_path / "gh.json"
    repo = {"id": "github:o/r", "title": "o/r", "hook": "h", "url": "https://github.com/o/r"}
    path.write_text(json.dumps({"items": [repo]}), encoding="utf-8")
    client = TestClient(
        create_app(tmp_path / "gh-data", path, fetch=lambda url: PDF),
        base_url="http://127.0.0.1:8765",
    )
    assert client.put("/api/favorites/github%3Ao%2Fr").status_code == 204
    assert [f["item_id"] for f in client.get("/api/favorites").json()] == ["github:o/r"]
    assert client.delete("/api/favorites/github%3Ao%2Fr").status_code == 204
    assert client.get("/api/favorites").json() == []
