"""Where the subscriber addresses come from. They never go into git, logs or the database."""

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Protocol

_ADDRESS = re.compile(r"^[a-z0-9._+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)+$")


class SubscriberStore(Protocol):
    def list(self) -> list[str]: ...


def parse_addresses(raw: str) -> tuple[list[str], int]:
    """Valid addresses (lowercase, unique, sorted) and the number of rejected entries.

    Anything with whitespace, control characters or angle brackets is rejected: an address is
    written into mail headers, so a newline in it could inject headers.
    """
    valid: set[str] = set()
    rejected = 0
    for part in raw.split(","):
        candidate = part.strip().lower()
        if not candidate:
            continue
        if _ADDRESS.fullmatch(candidate):
            valid.add(candidate)
        else:
            rejected += 1
    return sorted(valid), rejected


class EnvSubscribers:
    """The `SUBSCRIBERS` secret: addresses separated by commas."""

    def __init__(self, env: Mapping[str, str]) -> None:
        self._raw = env.get("SUBSCRIBERS", "")
        self.rejected = 0

    def list(self) -> list[str]:
        valid, self.rejected = parse_addresses(self._raw)
        return valid


class FileSubscribers:
    """The local `subscribers.txt` (one address per line, `#` comments), gitignored."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self.rejected = 0

    def list(self) -> list[str]:
        if not self._path.exists():
            return []
        lines = [line.strip() for line in self._path.read_text().splitlines()]
        kept = [line for line in lines if not line.startswith("#")]
        valid, self.rejected = parse_addresses(",".join(kept))
        return valid
