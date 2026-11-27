"""arXiv Atom API as pipeline items (pages fetched through retry)."""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from veille_llm.arxiv import Paper, _fetch_page, parse_feed
from veille_llm.models import Item
from veille_llm.retry import retry_call


def _to_item(paper: Paper) -> Item:
    return Item(
        id=f"arxiv:{paper.arxiv_id}",
        source="arxiv",
        kind="paper",
        title=paper.title,
        summary=paper.summary,
        url=paper.url,
        authors=paper.authors,
        published=paper.published,
        comment=paper.comment,
    )


def arxiv_source(
    days: int,
    fetch: Callable[[int, int], str] = _fetch_page,
    sleep: Callable[[float], None] = time.sleep,
    now: datetime | None = None,
    page_size: int = 200,
    max_pages: int = 10,
    delay: float = 3.0,
) -> list[Item]:
    cutoff = ((now or datetime.now(UTC)) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    items: list[Item] = []
    for page in range(max_pages):
        if page:
            sleep(delay)  # arXiv asks for 3 seconds between calls
        start = page * page_size
        batch = parse_feed(retry_call(lambda start=start: fetch(start, page_size), sleep=sleep))
        items.extend(_to_item(p) for p in batch if p.published >= cutoff)
        if len(batch) < page_size or batch[-1].published < cutoff:
            break
    return items
