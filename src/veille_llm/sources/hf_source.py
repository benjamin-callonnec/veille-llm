"""Hugging Face daily papers: upvotes are a best-effort signal, never a failure."""

from __future__ import annotations

import dataclasses
import json
import time
import urllib.request
from collections.abc import Callable

from veille_llm.hf import DAILY_PAPERS_URL, parse_upvotes
from veille_llm.models import Item
from veille_llm.retry import retry_call


def _fetch() -> bytes:
    request = urllib.request.Request(DAILY_PAPERS_URL, headers={"User-Agent": "veille-llm"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def hf_upvotes(
    fetch: Callable[[], bytes] = _fetch, sleep: Callable[[float], None] = time.sleep
) -> dict[str, int]:
    """arXiv id -> upvotes. Returns {} when Hugging Face is unreachable or malformed."""
    try:
        return parse_upvotes(json.loads(retry_call(fetch, sleep=sleep)))
    except Exception:  # noqa: BLE001 - the watch works without this signal
        return {}


def with_upvotes(items: list[Item], upvotes: dict[str, int]) -> list[Item]:
    out = []
    for item in items:
        votes = upvotes.get(item.id.removeprefix("arxiv:"), 0) if item.source == "arxiv" else 0
        out.append(dataclasses.replace(item, upvotes=max(item.upvotes, votes)))
    return out
