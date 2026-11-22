import subprocess
from pathlib import Path

from veille_llm.persist import publish, restore


def git(*args, cwd):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def make_remote(tmp_path) -> str:
    remote = tmp_path / "remote.git"
    git("init", "--bare", "-q", str(remote), cwd=tmp_path)
    return str(remote)


def test_restore_without_a_data_branch_is_a_first_run(tmp_path):
    db = tmp_path / "veille.db"
    assert restore(db, make_remote(tmp_path)) is False
    assert not db.exists()


def test_publish_then_restore_round_trips_the_database(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    db.write_bytes(b"one")
    publish(db, remote)
    other = tmp_path / "restored" / "veille.db"
    assert restore(other, remote) is True
    assert other.read_bytes() == b"one"


def test_publish_rewrites_the_branch_as_a_single_commit(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    for content in (b"one", b"two", b"three"):
        db.write_bytes(content)
        publish(db, remote)
    assert git("rev-list", "--count", "data", cwd=remote) == "1"
    assert git("show", "data:veille.db", cwd=remote) == "three"


def test_published_branch_holds_only_the_database(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    db.write_bytes(b"x")
    publish(db, remote)
    assert git("ls-tree", "--name-only", "data", cwd=remote) == "veille.db"


def test_publish_does_not_touch_the_current_repository(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    repo = tmp_path / "repo"
    repo.mkdir()
    git("init", "-q", cwd=repo)
    db.write_bytes(b"x")
    publish(db, remote)
    assert git("status", "--porcelain", cwd=repo) == ""
    assert Path(repo / ".git").exists()


def test_errors_never_echo_a_token_in_the_remote_url(tmp_path):
    import pytest

    db = tmp_path / "veille.db"
    db.write_bytes(b"x")
    with pytest.raises(RuntimeError) as err:
        publish(db, "https://x-access-token:SECRET123@127.0.0.1:1/none.git")
    assert "SECRET123" not in str(err.value)
