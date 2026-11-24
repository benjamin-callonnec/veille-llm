"""GitHub Search API: recent repos with the most stars, one search per topic."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from veille_llm.github import WINDOW_DAYS, parse_repo
from veille_llm.models import Item
from veille_llm.retry import retry_call
from veille_llm.sources import Source

API = "https://api.github.com"
MIN_STARS = 50
PER_TOPIC = 30


def _fetch(url: str) -> bytes:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "veille-llm"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:  # the workflow token raises the Search API limit from 10 to 30 a minute
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def github_source(
    topics: list[str],
    *,
    fetch: Callable[[str], bytes] = _fetch,
    now: datetime | None = None,
) -> Source:
    def source(days: int) -> list[Item]:  # the window is WINDOW_DAYS whatever the run asks
        since = ((now or datetime.now(UTC)) - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
        found: dict[str, Item] = {}
        errors: list[Exception] = []
        for topic in topics:
            query = urllib.parse.urlencode(
                {
                    "q": f"topic:{topic} created:>={since} stars:>={MIN_STARS} "
                    "fork:false archived:false",
                    "sort": "stars",
                    "order": "desc",
                    "per_page": PER_TOPIC,
                }
            )
            url = f"{API}/search/repositories?{query}"
            try:
                payload = json.loads(retry_call(lambda url=url: fetch(url)))
            except Exception as exc:  # noqa: BLE001 - one topic never blocks the others
                errors.append(exc)
                continue
            for raw in payload.get("items", []):
                item = parse_repo(raw)
                if item:
                    found.setdefault(item.id, item)
        if errors and len(errors) == len(topics):
            raise errors[0]
        return list(found.values())

    return source


def repo_lookup(
    name: str, published: str, *, fetch: Callable[[str], bytes] = _fetch
) -> Item | None:
    """One repo found through a story, dated by that story; None when it is gone (404)."""
    try:
        raw = json.loads(retry_call(lambda: fetch(f"{API}/repos/{name}")))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    return parse_repo(raw, published=published)
