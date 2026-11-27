import re
from datetime import UTC, date, datetime

from veille_llm.conferences import Conference
from veille_llm.models import Enrichment, Item, Verdict
from veille_llm.newsletter.select import MIN_ITEMS, select_items, select_sections, week_id
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


def test_no_minimum_number_of_items():
    assert MIN_ITEMS == 0  # nothing interesting means no mail, not a failure


def _seed_with_comments(specs):
    """specs: (id, score, comment); all published the same day, one upvote apart from none."""
    store = Store(":memory:")
    items = [
        Item(
            i,
            "arxiv",
            "paper",
            f"T{i}",
            "S",
            "https://e.com/" + i,
            [],
            "2026-11-20T00:00:00Z",
            comment=c,
        )
        for i, _, c in specs
    ]
    store.upsert_items(items, STAMP)
    store.save_verdicts([Verdict(s[0], True, s[1], "paper", "h") for s in specs])
    store.save_enrichments([Enrichment(i.id, "Cat", "Hook.", "Brief.") for i in items])
    return store


NEURIPS = "Accepted at NeurIPS 2026"


def test_sections_gather_matching_items_outside_the_excluded_ones():
    store = _seed_with_comments([("top", 9, NEURIPS), ("low", 2, NEURIPS), ("plain", 5, "")])
    (section,) = select_sections(store, NOW, exclude={"top"})
    assert section.conference == "NeurIPS 2026"
    assert [i["id"] for i in section.items] == ["low"]


def test_sections_are_empty_without_a_matching_comment_or_an_active_conference():
    store = _seed_with_comments([("a", 9, ""), ("b", 8, "Accepted at ICML 2026")])
    assert select_sections(store, NOW, exclude=set()) == []
    store = _seed_with_comments([("a", 9, NEURIPS)])
    assert select_sections(store, datetime(2026, 6, 1, tzinfo=UTC), exclude=set()) == []


def test_a_section_holds_at_most_five_items_best_first():
    store = _seed_with_comments([(f"i{n}", n, NEURIPS) for n in range(8)])
    (section,) = select_sections(store, NOW, exclude=set())
    assert [i["id"] for i in section.items] == ["i7", "i6", "i5", "i4", "i3"]


def test_an_item_matching_two_conferences_appears_only_in_the_first():
    first = Conference("One 2026", re.compile("both", re.I), date(2026, 11, 20), date(2026, 11, 25))
    second = Conference(
        "Two 2026", re.compile("both|two", re.I), date(2026, 11, 20), date(2026, 11, 25)
    )
    store = _seed_with_comments([("a", 9, "both"), ("b", 8, "two")])
    sections = select_sections(store, NOW, exclude=set(), calendar=(first, second))
    assert [(s.conference, [i["id"] for i in s.items]) for s in sections] == [
        ("One 2026", ["a"]),
        ("Two 2026", ["b"]),
    ]
