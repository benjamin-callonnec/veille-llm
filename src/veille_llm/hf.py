"""Hugging Face daily papers: which arXiv papers the community is upvoting."""

from __future__ import annotations

import json
import urllib.request

DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"


def parse_upvotes(payload: list[dict]) -> dict[str, int]:
    return {
        item["paper"]["id"]: int(item["paper"].get("upvotes", 0))
        for item in payload
        if "id" in item.get("paper", {})
    }


def fetch_upvotes() -> dict[str, int]:
    """arXiv id -> upvotes. Best effort: the watch still builds without this signal."""
    request = urllib.request.Request(DAILY_PAPERS_URL, headers={"User-Agent": "veille-llm"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return parse_upvotes(json.load(response))
    except (OSError, ValueError):
        return {}
