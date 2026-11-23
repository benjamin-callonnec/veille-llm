import json

from fastapi.testclient import TestClient

from veille_reader.server import create_app
from veille_reader.skills_sync import MAX_SKILL_BYTES, SKILLS_BRANCH, SKILLS_REPO, sync_skills


def urls(repo: str, branch: str) -> tuple[str, str]:
    return (
        f"https://api.github.com/repos/{repo}/contents/skills?ref={branch}",
        f"https://raw.githubusercontent.com/{repo}/{branch}/skills/",
    )


LIST_URL, RAW = urls("o/r", "skills")


def skill(name: str, body: str = "Do it.") -> str:
    return f"---\nname: {name}\ndescription: d {name}\n---\n{body}"


def fake(files: dict[str, str | bytes], listing=None, repo="o/r", branch="skills"):
    list_url, raw = urls(repo, branch)
    entries = listing or [{"name": n, "type": "file", "download_url": raw + n} for n in files]

    def fetch(url: str) -> bytes:
        if url == list_url:
            return json.dumps(entries).encode()
        name = url.removeprefix(raw)
        content = files[name]
        return content if isinstance(content, bytes) else content.encode()

    return fetch


def run(tmp_path, fetch):
    return sync_skills(tmp_path / "cache", fetch, repo="o/r", branch="skills")


def test_sync_writes_valid_files(tmp_path):
    assert run(tmp_path, fake({"a.md": skill("a"), "b.md": skill("b")})) == 2
    assert sorted(p.name for p in (tmp_path / "cache").iterdir()) == ["a.md", "b.md"]


def test_sync_ignores_non_md_and_unsafe_names(tmp_path):
    files = {"a.md": skill("a"), "x.txt": "t"}
    listing = [
        {"name": "a.md", "type": "file", "download_url": RAW + "a.md"},
        {"name": "x.txt", "type": "file", "download_url": RAW + "x.txt"},
        {"name": "../evil.md", "type": "file", "download_url": RAW + "evil.md"},
        {"name": "a/b.md", "type": "file", "download_url": RAW + "b.md"},
        {"name": "dir", "type": "dir", "download_url": None},
    ]
    assert run(tmp_path, fake(files, listing)) == 1
    assert [p.name for p in (tmp_path / "cache").iterdir()] == ["a.md"]
    assert not (tmp_path / "evil.md").exists()


def test_sync_refuses_download_from_other_host(tmp_path):
    listing = [{"name": "a.md", "type": "file", "download_url": "https://evil.example/a.md"}]
    assert run(tmp_path, fake({}, listing)) == -1


def test_sync_skips_invalid_and_oversized(tmp_path):
    files = {"a.md": skill("a"), "b.md": "garbage", "c.md": skill("c", "x" * (MAX_SKILL_BYTES + 1))}
    assert run(tmp_path, fake(files)) == 1


def test_sync_keeps_cache_when_fetch_fails(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "old.md").write_text(skill("old"))

    def broken(url):
        raise OSError("offline")

    assert run(tmp_path, broken) == -1
    assert (cache / "old.md").exists()


def test_sync_removes_skills_deleted_upstream(tmp_path):
    run(tmp_path, fake({"a.md": skill("a"), "b.md": skill("b")}))
    run(tmp_path, fake({"a.md": skill("a")}))
    assert [p.name for p in (tmp_path / "cache").iterdir()] == ["a.md"]


def test_sync_bad_listing_keeps_cache(tmp_path):
    run(tmp_path, fake({"a.md": skill("a")}))
    assert run(tmp_path, lambda url: b"not json") == -1
    assert (tmp_path / "cache" / "a.md").exists()


def make_client(tmp_path, fetch):
    catalogue = tmp_path / "catalogue.json"
    catalogue.write_text(json.dumps({"items": []}))
    app = create_app(
        tmp_path / "data", catalogue, skills_dir=tmp_path / "skills", skills_fetch=fetch
    )
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_get_skills_empty_cache(tmp_path):
    assert make_client(tmp_path, fake({})).get("/api/skills").json() == []


def test_get_skills_lists_without_prompt_then_sync_refreshes(tmp_path):
    client = make_client(
        tmp_path, fake({"a.md": skill("a")}, repo=SKILLS_REPO, branch=SKILLS_BRANCH)
    )
    assert client.get("/api/skills").json() == []
    assert client.post("/api/skills/sync").json() == {"count": 1}
    listed = client.get("/api/skills").json()
    assert listed == [{"name": "a", "description": "d a", "tools": []}]
