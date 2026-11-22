"""Store the long-lived Claude token of the local reader in .env (ignored by git, mode 600).

Run `claude setup-token` in a terminal first: it prints a token (sk-ant-oat01-...) valid for about
a year, unlike the interactive login session which expires. The token is read without echo and is
never printed or logged.
"""

import argparse
import getpass
import os
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
KEY = "CLAUDE_CODE_OAUTH_TOKEN"


def write_token(path: Path, token: str) -> None:
    token = token.strip()
    if not token.startswith("sk-ant-") or len(token) < 20 or any(c.isspace() for c in token):
        raise ValueError("not a Claude token")
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    entry = f"{KEY}={token}"
    for i, line in enumerate(lines):
        if line.strip().removeprefix("export ").strip().startswith(f"{KEY}="):
            lines[i] = entry
            break
    else:
        lines.append(entry)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".env-")
    try:
        os.chmod(tmp, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)
    os.chmod(path, 0o600)


def main(argv: list[str] | None = None, ask: Callable[[str], str] = getpass.getpass) -> int:
    parser = argparse.ArgumentParser(description="Save the Claude token for the local reader.")
    parser.add_argument("--env-file", type=Path, default=ENV_FILE)
    args = parser.parse_args(argv)
    print("1. In another terminal run:  claude setup-token")
    print("2. Copy the token it prints (it starts with sk-ant-) and paste it here.")
    token = ask("Token (hidden): ")
    try:
        write_token(args.env_file, token)
    except ValueError:
        print(
            "That does not look like a Claude token (it starts with sk-ant-). Nothing was written."
        )
        return 1
    print(f"Saved to {args.env_file} (mode 600, ignored by git). Restart `make reader`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
