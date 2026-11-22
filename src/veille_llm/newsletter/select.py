"""Which items go into this week's newsletter, and which week it is."""

from datetime import datetime, timedelta

from veille_llm.store import Store

MIN_ITEMS = 3
MAX_ITEMS = 8
_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def week_id(now: datetime) -> str:
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def select_items(
    store: Store, now: datetime, *, days: int = 7, limit: int = MAX_ITEMS
) -> list[dict]:
    """Published items of the last `days` days, best score first (then upvotes, then newest)."""
    since = (now - timedelta(days=days)).strftime(_FORMAT)
    items = store.published_items(since)
    items.sort(key=lambda i: (i["score"], i["upvotes"], i["published"]), reverse=True)
    return items[:limit]
