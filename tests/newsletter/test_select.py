from datetime import UTC, datetime

from veille_llm.models import Enrichment, Item, Verdict
from veille_llm.newsletter.select import MIN_ITEMS, select_items, week_id
from veille_llm.store import Store

NOW = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)  # Monday of ISO week 48
STAMP = "2026-11-23T08:00:00Z"


def seed(specs):
    store = Store(":memory:")
    items = [
        Item(i, "src", "paper", f"T{i}", "S", "https://e.com/" + i, [], pub, upvotes=up)
        for i, pub, up, _ in specs
    ]
    store.upsert_items(items, STAMP)
    store.save_verdicts(
        [Verdict(i.id, True, spec[3], "paper", "h") for i, spec in zip(items, specs, strict=True)]
    )
    store.save_enrichments([Enrichment(i.id, "Cat", "Hook.", "Brief.") for i in items])
    return store


def test_week_id_is_the_iso_week_and_changes_on_monday():
    assert week_id(datetime(2026, 11, 22, 23, 59, tzinfo=UTC)) == "2026-W47"
    assert week_id(NOW) == "2026-W48"
    assert week_id(datetime(2027, 1, 1, tzinfo=UTC)) == "2026-W53"  # ISO year, not calendar year


def test_best_score_first_then_upvotes_then_newest():
    store = seed(
        [
            ("low", "2026-11-22T00:00:00Z", 99, 3),
            ("tie-old", "2026-11-18T00:00:00Z", 5, 8),
            ("tie-up", "2026-11-18T00:00:00Z", 9, 8),
            ("top", "2026-11-17T00:00:00Z", 0, 9),
        ]
    )
    assert [i["id"] for i in select_items(store, NOW)] == ["top", "tie-up", "tie-old", "low"]


def test_only_the_last_seven_days_and_at_most_eight_items():
    specs = [(f"n{k}", "2026-11-20T00:00:00Z", 0, k) for k in range(10)]
    specs.append(("old", "2026-11-10T00:00:00Z", 0, 10))
    ids = [i["id"] for i in select_items(seed(specs), NOW)]
    assert len(ids) == 8 and "old" not in ids and ids[0] == "n9"


def test_min_items_is_three():
    assert MIN_ITEMS == 3
