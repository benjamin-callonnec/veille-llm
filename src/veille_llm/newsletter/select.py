"""Which items go into this week's newsletter, and which week it is."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from veille_llm.conferences import CONFERENCES, Conference, active, conference_of
from veille_llm.store import Store

MIN_ITEMS = 0  # nothing interesting this week means no mail (not a failure)
MAX_ITEMS = 8
SECTION_ITEMS = 5  # per conference, on top of the MAX_ITEMS of the digest
_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def week_id(now: datetime) -> str:
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def select_items(
    store: Store, now: datetime, *, days: int = 7, limit: int | None = MAX_ITEMS
) -> list[dict]:
    """Published items of the last `days` days, best score first (then upvotes, then newest)."""
    since = (now - timedelta(days=days)).strftime(_FORMAT)
    until = now.strftime(_FORMAT)
    items = [i for i in store.published_items(since) if i["published"] <= until]  # no future dates
    items.sort(key=lambda i: (i["score"], i["upvotes"], i["published"]), reverse=True)
    return items[:limit]


@dataclass(frozen=True)
class Section:
    conference: str
    items: list[dict]


def select_sections(
    store: Store,
    now: datetime,
    *,
    exclude: set[str],
    days: int = 7,
    limit: int = SECTION_ITEMS,
    calendar: Sequence[Conference] = CONFERENCES,
) -> list[Section]:
    """One section per active conference: the week's best items whose arXiv comment names it.

    Items already in the digest (`exclude`) are left out, and an item goes to the first
    matching conference only. A conference without any item gets no section.
    """
    if not active(now, calendar):
        return []
    items = [i for i in select_items(store, now, days=days, limit=None) if i["id"] not in exclude]
    comments = store.comments([i["id"] for i in items])
    grouped: dict[str, list[dict]] = {}
    for item in items:
        conference = conference_of(comments.get(item["id"], ""), now, calendar)
        if conference and len(grouped.setdefault(conference.name, [])) < limit:
            grouped[conference.name].append(item)
    return [Section(c.name, grouped[c.name]) for c in active(now, calendar) if c.name in grouped]
