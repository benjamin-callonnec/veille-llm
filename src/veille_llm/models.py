"""Data shapes shared by the pipeline stages."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Item:
    id: str  # "arxiv:<id>" or "rss:<16 hex of sha1(url)>"
    source: str
    kind: str  # "paper" or "news"
    title: str
    summary: str
    url: str
    authors: list[str]
    published: str  # ISO 8601 UTC, e.g. 2026-11-20T10:00:00Z
    upvotes: int = 0


@dataclass(frozen=True)
class Verdict:
    item_id: str
    interesting: bool
    score: int  # 0 to 10
    type: str  # "paper", "news" or "benchmark"
    category_hint: str


@dataclass(frozen=True)
class Enrichment:
    item_id: str
    category: str
    hook: str
    brief: str = ""
