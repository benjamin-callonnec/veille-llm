import sqlite3
import subprocess
from pathlib import Path

from veille_llm.persist import publish, restore


def git(*args, cwd):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def make_db(path, value):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE IF NOT EXISTS t (v TEXT)")
    con.execute("DELETE FROM t")
    con.execute("INSERT INTO t VALUES (?)", (value,))
    con.commit()
    con.close()


def read_db(path):
    con = sqlite3.connect(path)
    try:
        return con.execute("SELECT v FROM t").fetchone()[0]
    finally:
        con.close()


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
    make_db(db, "one")
    publish(db, remote)
    other = tmp_path / "restored" / "veille.db"
    assert restore(other, remote) is True
    assert read_db(other) == "one"


def test_publish_rewrites_the_branch_as_a_single_commit(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    for content in ("one", "two", "three"):
        make_db(db, content)
        publish(db, remote)
    assert git("rev-list", "--count", "data", cwd=remote) == "1"
    restore(tmp_path / "out.db", remote)
    assert read_db(tmp_path / "out.db") == "three"


def test_published_branch_holds_only_the_database(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    make_db(db, "x")
    publish(db, remote)
    assert git("ls-tree", "--name-only", "data", cwd=remote) == "veille.db"


def test_publish_does_not_touch_the_current_repository(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    repo = tmp_path / "repo"
    repo.mkdir()
    git("init", "-q", cwd=repo)
    make_db(db, "x")
    publish(db, remote)
    assert git("status", "--porcelain", cwd=repo) == ""
    assert Path(repo / ".git").exists()


def test_errors_never_echo_a_token_in_the_remote_url(tmp_path):
    import pytest

    db = tmp_path / "veille.db"
    make_db(db, "x")
    with pytest.raises(RuntimeError) as err:
        publish(db, "https://x-access-token:SECRET123@127.0.0.1:1/none.git")
    assert "SECRET123" not in str(err.value)


def test_a_corrupt_database_is_never_published_and_the_good_copy_survives(tmp_path):
    import pytest

    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    make_db(db, "good")
    publish(db, remote)
    db.write_bytes(b"this is not a sqlite file" * 100)
    with pytest.raises(RuntimeError, match="integrity"):
        publish(db, remote)
    restore(tmp_path / "out.db", remote)
    assert read_db(tmp_path / "out.db") == "good"


def test_publish_rolls_back_an_unfinished_transaction_left_by_a_crash(tmp_path):
    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    make_db(db, "committed")
    # Simulate a killed writer: a hot journal next to the db, copied with the half-written page.
    con = sqlite3.connect(db, isolation_level=None)
    con.execute("PRAGMA cache_size=1")
    con.execute("BEGIN")
    con.execute("UPDATE t SET v = 'half-written'")
    snapshot = {p.name: p.read_bytes() for p in tmp_path.glob("veille.db*")}
    con.close()
    for name, content in snapshot.items():
        (tmp_path / name).write_bytes(content)
    publish(db, remote)
    restore(tmp_path / "out.db", remote)
    assert read_db(tmp_path / "out.db") == "committed"


def test_cli_round_trip(tmp_path, capsys):
    from veille_llm.persist import main

    remote, db = make_remote(tmp_path), tmp_path / "veille.db"
    assert main(["restore", str(db), remote]) == 0
    make_db(db, "x")
    assert main(["publish", str(db), remote]) == 0
    assert main(["bogus"]) == 2
