"""Hacker News stories through the Algolia search API (free, no key)."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections.abc import Callable

from veille_llm.hn import SEARCH_URL, Story, parse_stories
from veille_llm.retry import retry_call

MIN_POINTS = 100  # about 30 to 60 stories a day; no topic filter, the LLM decides
MAX_DAYS = 2  # an older story we never saw is stale news


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "veille-llm"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def hn_stories(
    days: int,
    *,
    now: float | None = None,
    fetch: Callable[[str], bytes] = _fetch,
    min_points: int = MIN_POINTS,
) -> list[Story]:
    since = int(now if now is not None else time.time()) - min(days, MAX_DAYS) * 86400
    query = urllib.parse.urlencode(
        {
            "tags": "story",
            "numericFilters": f"points>={min_points},created_at_i>{since}",
            "hitsPerPage": 1000,
        }
    )
    return parse_stories(json.loads(retry_call(lambda: fetch(f"{SEARCH_URL}?{query}"))))
