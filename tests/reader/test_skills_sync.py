import io
import json
import zipfile

from fastapi.testclient import TestClient

from veille_reader.server import create_app
from veille_reader.skills_sync import (
    MAX_SKILL_BYTES,
    SKILLS_REPO,
    _GithubOnly,
    default_fetcher,
    sync_skills,
)

URL = "https://github.com/{}/releases/download/skills/skills.zip"


def skill(name: str, body: str = "Do it.") -> str:
    return f"---\nname: {name}\ndescription: d {name}\n---\n{body}"


def make_zip(files: dict[str, str | bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def serving(data: bytes, repo: str = "o/r"):
    asked = []

    def fetch(url: str) -> bytes:
        asked.append(url)
        assert url == URL.format(repo)
        return data

    fetch.asked = asked
    return fetch


def run(tmp_path, data: bytes):
    return sync_skills(tmp_path / "cache", serving(data), repo="o/r")


def names(tmp_path):
    return sorted(p.name for p in (tmp_path / "cache").iterdir())


def test_sync_writes_valid_files(tmp_path):
    assert run(tmp_path, make_zip({"a.md": skill("a"), "b.md": skill("b")})) == 2
    assert names(tmp_path) == ["a.md", "b.md"]


def test_sync_ignores_other_files_folders_and_unsafe_names(tmp_path):
    zipped = make_zip(
        {
            "a.md": skill("a"),
            "x.txt": "t",
            "../evil.md": skill("evil"),
            "sub/b.md": skill("b"),
            "/abs.md": skill("abs"),
            "A.md": skill("A"),
        }
    )
    assert run(tmp_path, zipped) == 1
    assert names(tmp_path) == ["a.md"]
    assert not (tmp_path / "evil.md").exists()


def test_sync_skips_invalid_and_oversized(tmp_path):
    zipped = make_zip(
        {"a.md": skill("a"), "b.md": "garbage", "c.md": skill("c", "x" * (MAX_SKILL_BYTES + 1))}
    )
    assert run(tmp_path, zipped) == 1
    assert names(tmp_path) == ["a.md"]


def test_sync_keeps_cache_when_the_zip_has_nothing_usable(tmp_path):
    run(tmp_path, make_zip({"a.md": skill("a")}))
    assert run(tmp_path, make_zip({"bad.md": "garbage"})) == -1
    assert run(tmp_path, make_zip({})) == -1
    assert names(tmp_path) == ["a.md"]


def test_sync_keeps_cache_when_fetch_fails_or_the_zip_is_broken(tmp_path):
    run(tmp_path, make_zip({"a.md": skill("a")}))

    def offline(url):
        raise OSError("offline")

    assert sync_skills(tmp_path / "cache", offline, repo="o/r") == -1
    assert run(tmp_path, b"not a zip") == -1
    assert run(tmp_path, b"x" * 1_100_000) == -1
    assert names(tmp_path) == ["a.md"]


def test_sync_removes_skills_deleted_upstream(tmp_path):
    run(tmp_path, make_zip({"a.md": skill("a"), "b.md": skill("b")}))
    run(tmp_path, make_zip({"a.md": skill("a")}))
    assert names(tmp_path) == ["a.md"]


def test_sync_leaves_no_staging_folder_behind(tmp_path):
    run(tmp_path, make_zip({"a.md": skill("a")}))
    assert [p.name for p in tmp_path.iterdir()] == ["cache"]


def test_the_default_fetcher_only_talks_to_github():
    import pytest

    for url in ("http://github.com/x", "https://evil.example/x", "https://notgithub.com/x"):
        with pytest.raises(OSError):
            default_fetcher(url)
    handler = _GithubOnly()
    with pytest.raises(OSError):
        handler.redirect_request(None, None, 302, "", {}, "https://evil.example/skills.zip")


def make_client(tmp_path, fetch):
    catalogue = tmp_path / "catalogue.json"
    catalogue.write_text(json.dumps({"items": []}))
    app = create_app(
        tmp_path / "data", catalogue, skills_dir=tmp_path / "skills", skills_fetch=fetch
    )
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_get_skills_empty_cache(tmp_path):
    assert make_client(tmp_path, serving(b"")).get("/api/skills").json() == []


def test_get_skills_lists_without_prompt_then_sync_refreshes(tmp_path):
    client = make_client(tmp_path, serving(make_zip({"a.md": skill("a")}), repo=SKILLS_REPO))
    assert client.get("/api/skills").json() == []
    assert client.post("/api/skills/sync").json() == {"count": 1}
    assert client.get("/api/skills").json() == [{"name": "a", "description": "d a", "tools": []}]
