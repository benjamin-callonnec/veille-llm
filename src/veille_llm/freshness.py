"""Alert when no `daily` run succeeded recently (the Cloudflare Worker may have stopped).

Reads `gh run list --workflow daily.yml --status success --json createdAt` on stdin (newest first)
and exits 1 when the latest successful run is older than `--max-hours` (30 by default), or when the
input is unreadable: a silent check is worse than a noisy one. Standard library only.
"""

import argparse
import json
import sys
from datetime import UTC, datetime

DEFAULT_MAX_HOURS = 30.0


def _now() -> datetime:
    return datetime.now(UTC)


def check(runs: list[dict], now: datetime, max_hours: float) -> tuple[bool, str]:
    """(fresh, message): fresh when the latest successful run is at most `max_hours` old."""
    if not runs:
        return False, "no successful run found"
    created = datetime.fromisoformat(runs[0]["createdAt"].replace("Z", "+00:00"))
    age = (now - created).total_seconds() / 3600
    return (
        age <= max_hours,
        f"latest successful daily run: {age:.1f} hours ago (limit {max_hours:g})",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-hours", type=float, default=DEFAULT_MAX_HOURS)
    args = parser.parse_args(argv)
    try:
        fresh, message = check(json.load(sys.stdin), _now(), args.max_hours)
    except (ValueError, KeyError, TypeError, IndexError, AttributeError):
        print("cannot read the list of runs: treating the daily run as stale")
        return 1
    print(message)
    return 0 if fresh else 1


if __name__ == "__main__":
    sys.exit(main())
