"""Manage the local subscribers.txt and push it to the SUBSCRIBERS GitHub secret.

    python scripts/subs.py add|remove EMAIL | list | push

The file is gitignored; addresses are never printed by `push`. `push` uses the personal GitHub
account (see .claude/CLAUDE.md), not the active work account.
"""

import os
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from veille_llm.newsletter.subscribers import FileSubscribers, parse_addresses

REPO = "benjamin-callonnec/veille-llm"
PERSONAL_ACCOUNT = "benjamin-callonnec"
DEFAULT_PATH = Path("subscribers.txt")


def _gh_env(token: str) -> dict[str, str]:
    # HOME is required: without it gh writes its state under ./.local in the current directory.
    return {
        "GH_TOKEN": token,
        "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
        "HOME": os.environ.get("HOME") or tempfile.gettempdir(),
    }


def _gh(cmd: list[str], text: str, token: str) -> int:
    return subprocess.run(cmd, input=text, text=True, env=_gh_env(token)).returncode


def _personal_token() -> str:
    result = subprocess.run(
        ["gh", "auth", "token", "--user", PERSONAL_ACCOUNT], capture_output=True, text=True
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise SystemExit(f"gh is not logged in as {PERSONAL_ACCOUNT}")
    return result.stdout.strip()


def _save(path: Path, addresses: list[str]) -> None:
    path.write_text("".join(f"{a}\n" for a in addresses))


def main(
    argv: list[str],
    *,
    path: Path = DEFAULT_PATH,
    gh: Callable[[list[str], str, str], int] = _gh,
    token: str | None = None,
) -> int:
    command = argv[0] if argv else ""
    current = FileSubscribers(path).list()
    if command in ("add", "remove") and len(argv) == 2:
        valid, _ = parse_addresses(argv[1])
        if len(valid) != 1:
            print("not a valid address", file=sys.stderr)
            return 1
        address = valid[0]
        if command == "add":
            _save(path, sorted({*current, address}))
            return 0
        if address not in current:
            print("address not in the list", file=sys.stderr)
            return 1
        _save(path, [a for a in current if a != address])
        return 0
    if command == "list":
        print("\n".join(current))
        return 0
    if command == "push":
        if not current:
            print(
                "refusing to push an empty list (wrong directory or missing file?)", file=sys.stderr
            )
            return 1
        cmd = ["gh", "secret", "set", "SUBSCRIBERS", "-R", REPO]
        code = gh(cmd, ",".join(current), token or _personal_token())
        print(f"pushed {len(current)} subscribers" if code == 0 else "gh secret set failed")
        return code
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
