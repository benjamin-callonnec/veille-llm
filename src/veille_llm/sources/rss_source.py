"""RSS and Atom feeds as pipeline items."""

from __future__ import annotations

import hashlib
import html
import re
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime

import feedparser

from veille_llm.models import Item
from veille_llm.retry import retry_call
from veille_llm.sources import Source

_TAGS = re.compile(r"<[^>]+>")


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "veille-llm"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def _plain(text: str) -> str:
    return " ".join(html.unescape(_TAGS.sub(" ", text or "")).split())


def rss_source(name: str, url: str, fetch: Callable[[str], bytes] = _fetch) -> Source:
    def source(days: int) -> list[Item]:
        feed = feedparser.parse(retry_call(lambda: fetch(url)))
        items = []
        for entry in feed.entries:
            title, link = _plain(entry.get("title", "")), entry.get("link", "")
            if not title or not link:
                continue
            stamp = entry.get("published_parsed") or entry.get("updated_parsed")
            when = datetime(*stamp[:6], tzinfo=UTC) if stamp else datetime.now(UTC)
            items.append(
                Item(
                    id="rss:" + hashlib.sha1(link.encode()).hexdigest()[:16],
                    source=name,
                    kind="news",
                    title=title,
                    summary=_plain(entry.get("summary", ""))[:2000],
                    url=link,
                    authors=[entry["author"]] if entry.get("author") else [],
                    published=when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                )
            )
        return items

    return source
