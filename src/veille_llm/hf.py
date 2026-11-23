"""Hugging Face daily papers: which arXiv papers the community is upvoting."""

from __future__ import annotations

from typing import NamedTuple

DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"


class Signal(NamedTuple):
    """What the community says about a paper: HF upvotes and the stars of its linked repo."""

    upvotes: int = 0
    github_stars: int = 0


def _count(value: object) -> int:
    """A count from a payload we do not control: anything but a non-negative integer is 0."""
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def parse_signals(payload: list[dict]) -> dict[str, Signal]:
    return {
        item["paper"]["id"]: Signal(
            _count(item["paper"].get("upvotes")), _count(item["paper"].get("githubStars"))
        )
        for item in payload
        if "id" in item.get("paper", {})
    }
