"""The local `.env` file of the reader: it may only carry the Claude token (nothing that bills)."""

import os
import stat
from collections.abc import MutableMapping
from pathlib import Path

# Only this key is ever taken from the file. ANTHROPIC_API_KEY and the provider switches would move
# the reader off the subscription (and the reader refuses them), so they are never loaded.
ALLOWED_KEYS = {"CLAUDE_CODE_OAUTH_TOKEN"}


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def load_env_file(path: Path, environ: MutableMapping[str, str] = os.environ) -> list[str]:
    """Put the allowed keys of the file into the environment unless already set there.

    Returns the names that were loaded, never the values.
    """
    try:
        values = parse_env(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return []
    loaded = []
    for key in sorted(ALLOWED_KEYS):
        value = values.get(key, "")
        if value and not environ.get(key):
            environ[key] = value
            loaded.append(key)
    return loaded


def permission_warning(path: Path) -> str | None:
    """A message when other users of the machine could read the file, else None."""
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
    except OSError:
        return None
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        return f"{path.name} is readable by other users: run `chmod 600 {path.name}`"
    return None
