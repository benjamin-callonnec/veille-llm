"""Keep `veille.db` on an orphan `data` branch, rewritten as a single commit each time.

The remote is any git URL or path. Everything happens in a throwaway repository, so the
working tree of the caller is never touched. The database holds no personal data.
"""

import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

BRANCH = "data"
FILE = "veille.db"
_IDENTITY = ["-c", "user.name=veille-bot", "-c", "user.email=veille-bot@users.noreply.github.com"]


def _git(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        # The remote URL may carry a token: never echo it.
        stderr = re.sub(r"://[^@/\s]+@", "://***@", result.stderr)
        raise RuntimeError(f"git {args[0]} failed: {stderr.strip()}")
    return result


def restore(db: Path, remote: str) -> bool:
    """Write the stored database to `db`. False on a first run (no `data` branch yet)."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        _git("init", "-q", cwd=work)
        if (
            _git(
                "ls-remote", "--exit-code", "--heads", remote, BRANCH, cwd=work, check=False
            ).returncode
            == 2
        ):
            return False
        _git("fetch", "-q", "--depth=1", remote, BRANCH, cwd=work)
        content = subprocess.run(
            ["git", "show", f"FETCH_HEAD:{FILE}"], cwd=work, capture_output=True, check=True
        ).stdout
    db.parent.mkdir(parents=True, exist_ok=True)
    db.write_bytes(content)
    return True


def _snapshot(db: Path, target: Path) -> None:
    """Copy a consistent, verified database. Opening it rolls back a crashed transaction."""
    try:
        source = sqlite3.connect(db)
        try:
            if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise sqlite3.DatabaseError("integrity_check failed")
            copy = sqlite3.connect(target)
            try:
                source.backup(copy)
            finally:
                copy.close()
        finally:
            source.close()
    except sqlite3.DatabaseError as exc:
        raise RuntimeError(f"refusing to publish: database integrity check failed ({exc})") from exc


def publish(db: Path, remote: str) -> None:
    """Replace the `data` branch by one commit holding only the database."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        _git("init", "-q", "-b", BRANCH, cwd=work)
        _snapshot(db, work / FILE)
        _git("add", FILE, cwd=work)
        _git(*_IDENTITY, "commit", "-q", "-m", "chore(data): update veille.db", cwd=work)
        _git("push", "-q", "--force", remote, f"{BRANCH}:{BRANCH}", cwd=work)


def main(argv: list[str] | None = None) -> int:
    """`python -m veille_llm.persist restore|publish DB REMOTE`."""
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 3 or args[0] not in ("restore", "publish"):
        print("usage: python -m veille_llm.persist restore|publish DB REMOTE", file=sys.stderr)
        return 2
    db, remote = Path(args[1]), args[2]
    if args[0] == "restore":
        print("restored" if restore(db, remote) else "no data branch yet (first run)")
    else:
        publish(db, remote)
        print("published")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
