"""Hugging Face daily papers: upvotes and GitHub stars are best-effort signals, never a failure."""

from __future__ import annotations

import dataclasses
import json
import time
import urllib.request
from collections.abc import Callable

from veille_llm.hf import DAILY_PAPERS_URL, Signal, parse_signals
from veille_llm.models import Item
from veille_llm.retry import retry_call


def _fetch() -> bytes:
    request = urllib.request.Request(DAILY_PAPERS_URL, headers={"User-Agent": "veille-llm"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def hf_signals(
    fetch: Callable[[], bytes] = _fetch, sleep: Callable[[float], None] = time.sleep
) -> dict[str, Signal]:
    """arXiv id -> upvotes and GitHub stars; {} when Hugging Face is unreachable or malformed."""
    try:
        return parse_signals(json.loads(retry_call(fetch, sleep=sleep)))
    except Exception:  # noqa: BLE001 - the watch works without this signal
        return {}


def with_signals(items: list[Item], signals: dict[str, Signal]) -> list[Item]:
    out = []
    for item in items:
        signal = (
            signals.get(item.id.removeprefix("arxiv:"), Signal())
            if item.source == "arxiv"
            else Signal()
        )
        out.append(
            dataclasses.replace(
                item,
                upvotes=max(item.upvotes, signal.upvotes),
                github_stars=max(item.github_stars, signal.github_stars),
            )
        )
    return out
