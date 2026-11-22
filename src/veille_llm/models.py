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


@dataclass(frozen=True)
class Provenance:
    """What produced a stored result: the model, the prompt (hash) and the pipeline version."""

    model: str
    prompt: str
    pipeline: str


def content_hash(title: str) -> str:
    """Hash of the normalised title, to spot the same article under two ids ('' if too short)."""
    import hashlib
    import re

    words = " ".join(re.findall(r"[a-z0-9]+", title.lower()))
    if len(words) < 25:  # short titles ("Introducing X") would collide across unrelated posts
        return ""
    return hashlib.sha256(words.encode()).hexdigest()[:16]


LEGACY = Provenance("legacy", "legacy", "legacy")  # rows written before provenance existed
