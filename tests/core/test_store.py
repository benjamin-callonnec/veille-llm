import sqlite3

import pytest

from veille_llm.models import Enrichment, Item, Verdict
from veille_llm.store import Store

NOW = "2026-11-21T12:00:00Z"


def item(i: str, published: str = "2026-11-20T10:00:00Z", upvotes: int = 0) -> Item:
    return Item(
        id=i,
        source="arxiv",
        kind="paper",
        title=f"Title {i}",
        summary=f"Summary {i}",
        url=f"https://example.com/{i}",
        authors=["Ada"],
        published=published,
        upvotes=upvotes,
    )


def verdict(i: str, interesting: bool = True) -> Verdict:
    return Verdict(
        item_id=i, interesting=interesting, score=7, type="paper", category_hint="state space"
    )


@pytest.fixture
def store():
    return Store(":memory:")


def test_upsert_inserts_new_items_once(store):
    assert store.upsert_items([item("a"), item("b")], NOW) == 2
    assert store.upsert_items([item("a"), item("b")], NOW) == 0
    assert store.known_ids(["a", "b", "c"]) == {"a", "b"}


def test_upsert_keeps_status_and_refreshes_upvotes(store):
    store.upsert_items([item("a")], NOW)
    store.save_verdicts([verdict("a")])
    store.upsert_items([item("a", upvotes=9)], NOW)
    assert store.pending_classification() == []
    assert [i.id for i, _ in store.pending_enrichment()] == ["a"]
    assert store.pending_enrichment()[0][0].upvotes == 9


def test_pending_classification_excludes_already_classified(store):
    store.upsert_items([item("a"), item("b")], NOW)
    store.save_verdicts([verdict("a")])
    assert [i.id for i in store.pending_classification()] == ["b"]
    assert [i.id for i in store.pending_classification(limit=0)] == []


def test_save_verdicts_sets_interesting_or_rejected(store):
    store.upsert_items([item("a"), item("b")], NOW)
    store.save_verdicts([verdict("a", True), verdict("b", False)])
    assert [i.id for i, _ in store.pending_enrichment()] == ["a"]
    assert store.pending_classification() == []


def test_save_verdicts_is_atomic(store):
    store.upsert_items([item("a")], NOW)
    with pytest.raises(sqlite3.IntegrityError):
        store.save_verdicts([verdict("a"), verdict("ghost")])
    assert [i.id for i in store.pending_classification()] == ["a"]
    assert store.pending_enrichment() == []


def test_save_enrichments_creates_categories_and_publishes(store):
    store.upsert_items([item("a")], NOW)
    store.save_verdicts([verdict("a")])
    store.save_enrichments([Enrichment("a", "State space", "A short hook.")])
    assert store.category_names() == ["State space"]
    (published,) = store.published_items("2026-01-01T00:00:00Z")
    assert published["id"] == "a"
    assert published["category"] == "State space"
    assert published["hook"] == "A short hook."
    assert published["score"] == 7
    assert store.pending_enrichment() == []


def test_abandon_stale_only_touches_old_unfinished_items(store):
    store.upsert_items([item("old")], "2026-11-10T00:00:00Z")
    store.upsert_items([item("fresh")], "2026-11-21T00:00:00Z")
    store.upsert_items([item("done")], "2026-11-10T00:00:00Z")
    store.save_verdicts([verdict("done")])
    store.save_enrichments([Enrichment("done", "Cat", "Hook.")])
    assert store.abandon_stale(NOW, max_age_days=3) == 1
    assert [i.id for i in store.pending_classification()] == ["fresh"]
    assert [p["id"] for p in store.published_items("2026-01-01T00:00:00Z")] == ["done"]


def test_published_items_excludes_unfinished_and_old_items(store):
    store.upsert_items(
        [
            item("new"),
            item("interesting"),
            item("published"),
            item("ancient", "2025-01-01T00:00:00Z"),
        ],
        NOW,
    )
    store.save_verdicts([verdict("interesting"), verdict("published"), verdict("ancient")])
    store.save_enrichments(
        [Enrichment("published", "Cat", "Hook."), Enrichment("ancient", "Cat", "Hook.")]
    )
    ids = [p["id"] for p in store.published_items("2026-01-01T00:00:00Z")]
    assert ids == ["published"]


def test_store_survives_reopen(tmp_path):
    path = tmp_path / "veille.db"
    first = Store(path)
    first.upsert_items([item("a")], NOW)
    first.save_verdicts([verdict("a")])
    first.close()
    second = Store(path)
    assert second.known_ids(["a"]) == {"a"}
    assert [i.id for i, _ in second.pending_enrichment()] == ["a"]


def test_refresh_upvotes_raises_but_never_lowers_and_keeps_status(store):
    store.upsert_items([item("a", upvotes=3)], NOW)
    store.save_verdicts([verdict("a")])
    store.refresh_upvotes({"a": 9, "ghost": 5})
    store.refresh_upvotes({"a": 4})
    (pending, _) = store.pending_enrichment()[0]
    assert pending.upvotes == 9


def test_published_item_carries_its_brief(store):
    store.upsert_items([item("a")], NOW)
    store.save_verdicts([verdict("a")])
    store.save_enrichments([Enrichment("a", "Cat", "Hook.", "A brief.")])
    (published,) = store.published_items("2026-01-01T00:00:00Z")
    assert published["brief"] == "A brief."


def test_store_adds_the_brief_column_to_an_existing_database(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE enrichments (item_id TEXT PRIMARY KEY, category TEXT NOT NULL, "
        "hook TEXT NOT NULL); INSERT INTO enrichments VALUES ('x', 'Cat', 'Old hook.');"
    )
    old.commit()
    old.close()
    Store(path).close()
    cols = [r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(enrichments)")]
    assert "brief" in cols
