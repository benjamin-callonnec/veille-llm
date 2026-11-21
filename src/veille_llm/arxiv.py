"""Minimal client for the arXiv Atom API."""

from __future__ import annotations

import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

API_URL = "https://export.arxiv.org/api/query"
CATEGORIES = ("cs.CL", "cs.LG", "cs.AI")
_ATOM = "{http://www.w3.org/2005/Atom}"
_VERSION = re.compile(r"v\d+$")


@dataclass(frozen=True)
class Paper:
    arxiv_id: str
    title: str
    summary: str
    authors: list[str]
    published: str
    url: str


def _clean(text: str | None) -> str:
    return " ".join((text or "").split())


def parse_feed(xml_text: str) -> list[Paper]:
    root = ET.fromstring(xml_text)
    papers = []
    for entry in root.findall(f"{_ATOM}entry"):
        raw_id = entry.findtext(f"{_ATOM}id", "")
        arxiv_id = _VERSION.sub("", raw_id.rsplit("/abs/", 1)[-1])
        papers.append(
            Paper(
                arxiv_id=arxiv_id,
                title=_clean(entry.findtext(f"{_ATOM}title")),
                summary=_clean(entry.findtext(f"{_ATOM}summary")),
                authors=[
                    _clean(a.findtext(f"{_ATOM}name")) for a in entry.findall(f"{_ATOM}author")
                ],
                published=entry.findtext(f"{_ATOM}published", ""),
                url=f"https://arxiv.org/abs/{arxiv_id}",
            )
        )
    return papers


def _fetch_page(start: int, page_size: int) -> str:
    query = urllib.parse.urlencode(
        {
            "search_query": " OR ".join(f"cat:{c}" for c in CATEGORIES),
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "start": start,
            "max_results": page_size,
        }
    )
    request = urllib.request.Request(f"{API_URL}?{query}", headers={"User-Agent": "veille-llm"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def fetch_recent(days: int, page_size: int = 200, max_pages: int = 10, delay: float = 3.0):
    """Papers submitted in the last `days` days, newest first (arXiv asks for 3 s between calls)."""
    cutoff = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    papers: list[Paper] = []
    for page in range(max_pages):
        if page:
            time.sleep(delay)
        batch = parse_feed(_fetch_page(page * page_size, page_size))
        papers.extend(p for p in batch if p.published >= cutoff)
        if len(batch) < page_size or batch[-1].published < cutoff:
            break
    return papers
