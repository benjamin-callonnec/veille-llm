"""Deterministic filter: window, known ids, duplicates, cheap keyword pre-filter."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from veille_llm.github import WINDOW_DAYS
from veille_llm.models import Item

PREFILTER = re.compile(
    r"\b(llms?|language models?|transformers?|attention|state[- ]space|mamba"
    r"|mixture[- ]of[- ]experts|agents?|agentic|reasoning|benchmarks?|retrieval"
    r"|knowledge graphs?|diffusion language)\b",
    re.IGNORECASE,
)
MIN_UPVOTES = 5


def _normalise(title: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", title.lower()).split())


def _parse(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def deterministic_filter(
    items: list[Item], *, known_ids: set[str], now: datetime, days: int
) -> list[Item]:
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    kept = []
    for item in items:
        window = max(days, WINDOW_DAYS) if item.kind == "github" else days
        if item.id in known_ids or item.id in seen_ids:
            continue
        if _parse(item.published) < now - timedelta(days=window):
            continue
        title_key = _normalise(item.title)
        if title_key in seen_titles:
            continue
        if item.kind == "paper" and item.upvotes < MIN_UPVOTES:
            if not PREFILTER.search(f"{item.title} {item.summary}"):
                continue
        seen_ids.add(item.id)
        seen_titles.add(title_key)
        kept.append(item)
    return kept
