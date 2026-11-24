"""Remote sources. One failing source never blocks the others."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TypeVar

from veille_llm.models import Item

Source = Callable[[int], list[Item]]  # argument: number of days to look back
T = TypeVar("T")

# Verified on 2026-11-21. Anthropic and Meta AI have no official feed (404): skipped in v1.
RSS_FEEDS: dict[str, str] = {
    "openai": "https://openai.com/news/rss.xml",
    "huggingface": "https://huggingface.co/blog/feed.xml",
    "deepmind": "https://deepmind.google/blog/rss.xml",
}


@dataclass(frozen=True)
class SourceReport:
    name: str
    ok: bool
    count: int
    error: str | None


def collect_all(
    sources: Mapping[str, Callable[[int], list[T]]], days: int
) -> tuple[list[T], list[SourceReport]]:
    items: list[T] = []
    reports: list[SourceReport] = []
    for name, source in sources.items():
        try:
            found = source(days)
        except Exception as exc:  # noqa: BLE001 - a source must never take the run down
            reports.append(SourceReport(name, False, 0, f"{type(exc).__name__}: {exc}"))
            continue
        items.extend(found)
        reports.append(SourceReport(name, True, len(found), None))
    return items, reports
