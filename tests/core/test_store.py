import sqlite3

import pytest

from veille_llm.hf import Signal
from veille_llm.models import Enrichment, Item, Mention, Verdict
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


def test_refresh_signals_keeps_the_status_of_a_classified_item(store):
    store.upsert_items([item("a", upvotes=3)], NOW)
    store.save_verdicts([verdict("a")])
    store.refresh_signals({"a": Signal(9, 0), "ghost": Signal(5, 0)})
    store.refresh_signals({"a": Signal(4, 0)})
    (pending, _) = store.pending_enrichment()[0]
    assert pending.upvotes == 9


def test_refresh_signals_raises_both_but_never_lowers(store):
    store.upsert_items([item("a", upvotes=3)], NOW)
    store.refresh_signals({"a": Signal(9, 50), "ghost": Signal(5, 5)})
    store.refresh_signals({"a": Signal(4, 20)})
    (pending,) = store.pending_classification()
    assert (pending.upvotes, pending.github_stars) == (9, 50)


def test_published_item_carries_its_github_stars(store):
    store.upsert_items([item("a")], NOW)
    store.save_verdicts([verdict("a")])
    store.save_enrichments([Enrichment("a", "Cat", "Hook.", "A brief.")])
    store.refresh_signals({"a": Signal(2, 77)})
    (published,) = store.published_items("2026-01-01T00:00:00Z")
    assert published["github_stars"] == 77 and published["upvotes"] == 2
    assert published["brief"] == "A brief." and published["score"] == 7


def test_old_databases_get_the_github_stars_column_at_zero(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE items (id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,"
        " title TEXT NOT NULL, summary TEXT NOT NULL, url TEXT NOT NULL, authors TEXT NOT NULL,"
        " published TEXT NOT NULL, upvotes INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL,"
        " status TEXT NOT NULL DEFAULT 'new');"
        "INSERT INTO items VALUES ('x','s','paper','T','S','u','[]','2026-11-20T00:00:00Z',4,"
        "'2026-11-20T00:00:00Z','new');"
    )
    old.commit()
    old.close()
    store = Store(path)
    (got,) = store.pending_classification()
    assert (got.upvotes, got.github_stars) == (4, 0)


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


def test_fallback_category_is_english_and_old_autres_rows_are_migrated(tmp_path):
    import sqlite3

    from veille_llm.pipeline.categorize import FALLBACK_CATEGORY

    assert FALLBACK_CATEGORY == "Other"
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE categories (name TEXT PRIMARY KEY);"
        "INSERT INTO categories VALUES ('Autres'), ('Other'), ('Agents');"
        "CREATE TABLE enrichments (item_id TEXT PRIMARY KEY, category TEXT NOT NULL, "
        "hook TEXT NOT NULL);"
        "INSERT INTO enrichments VALUES ('x', 'Autres', 'h');"
    )
    old.commit()
    old.close()
    store = Store(path)
    assert sorted(store.category_names()) == ["Agents", "Other"]
    row = sqlite3.connect(path).execute("SELECT category FROM enrichments").fetchone()
    assert row == ("Other",)


def test_autres_migration_is_idempotent_and_handles_a_missing_other(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE categories (name TEXT PRIMARY KEY); INSERT INTO categories VALUES ('Autres');"
    )
    old.commit()
    old.close()
    Store(path).close()
    again = Store(path)
    assert again.category_names() == ["Other"]


def _enriched(store, rows):
    """rows: (id, published, category)"""
    items = [Item(i, "s", "paper", f"T {i}", "S", "https://e.com", [], p) for i, p, _ in rows]
    store.upsert_items(items, NOW)
    store.save_verdicts([Verdict(i.id, True, 5, "paper", "h") for i in items])
    store.save_enrichments([Enrichment(i, c, f"Hook {i}.", "B.") for i, _, c in rows])


def test_category_usage_counts_only_published_items_inside_the_window():
    store = Store(":memory:")
    _enriched(
        store,
        [
            ("a", "2026-11-20T00:00:00Z", "Agents"),
            ("b", "2026-11-19T00:00:00Z", "Agents"),
            ("c", "2026-11-18T00:00:00Z", "Security"),
            ("old", "2026-09-01T00:00:00Z", "Ancient"),
        ],
    )
    usage = store.category_usage("2026-11-01T00:00:00Z")
    assert usage == [("Agents", 2), ("Security", 1)]  # "Ancient" left the window: slot freed


def test_rename_category_moves_every_item_and_keeps_the_category_table_in_sync():
    store = Store(":memory:")
    _enriched(store, [("a", "2026-11-20T00:00:00Z", "Tiny"), ("b", "2026-11-20T00:00:00Z", "Big")])
    assert store.rename_category("Tiny", "Big") == 1
    assert store.category_usage("2026-11-01T00:00:00Z") == [("Big", 2)]


def test_reassign_other_only_touches_items_currently_in_other():
    store = Store(":memory:")
    _enriched(
        store, [("a", "2026-11-20T00:00:00Z", "Other"), ("b", "2026-11-20T00:00:00Z", "Keep")]
    )
    assert store.reassign_other("a", "Agents") is True
    assert store.reassign_other("b", "Agents") is False
    assert dict(store.category_usage("2026-11-01T00:00:00Z")) == {"Agents": 1, "Keep": 1}


def test_other_items_lists_newest_first_with_hook_and_respects_the_limit():
    store = Store(":memory:")
    _enriched(
        store,
        [
            ("old", "2026-11-10T00:00:00Z", "Other"),
            ("new", "2026-11-20T00:00:00Z", "Other"),
            ("x", "2026-11-20T00:00:00Z", "Agents"),
        ],
    )
    rows = store.other_items("2026-11-01T00:00:00Z", limit=1)
    assert [r["id"] for r in rows] == ["new"] and rows[0]["hook"] == "Hook new."


def _prov(model="m", prompt="p", pipeline="1.0.0"):
    from veille_llm.models import Provenance

    return Provenance(model, prompt, pipeline)


def test_results_are_saved_with_their_provenance_and_legacy_by_default():
    store = Store(":memory:")
    store.upsert_items([item("a"), item("b")], NOW)
    store.save_verdicts([verdict("a")], _prov("haiku", "h1", "1.2.0"))
    store.save_verdicts([verdict("b")])
    rows = dict(
        (r[0], tuple(r[1:]))
        for r in store._conn.execute("SELECT item_id, model, prompt, pipeline FROM verdicts")
    )
    assert rows["a"] == ("haiku", "h1", "1.2.0") and rows["b"] == ("legacy",) * 3
    store.save_enrichments([Enrichment("a", "Cat", "H.", "B.")], _prov("haiku", "h2", "1.2.0"))
    got = store._conn.execute("SELECT model, prompt, pipeline FROM enrichments").fetchone()
    assert got == ("haiku", "h2", "1.2.0")


def test_old_databases_get_provenance_columns_marked_legacy(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE items (id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,"
        " title TEXT NOT NULL, summary TEXT NOT NULL, url TEXT NOT NULL, authors TEXT NOT NULL,"
        " published TEXT NOT NULL, upvotes INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL,"
        " status TEXT NOT NULL DEFAULT 'new');"
        "INSERT INTO items VALUES ('x','s','paper','A long enough title for the dedupe hash',"
        "'S','u','[]','2026-11-20T00:00:00Z',0,'2026-11-20T00:00:00Z','published');"
        "CREATE TABLE verdicts (item_id TEXT PRIMARY KEY, interesting INTEGER NOT NULL,"
        " score INTEGER NOT NULL, type TEXT NOT NULL, category_hint TEXT NOT NULL);"
        "INSERT INTO verdicts VALUES ('x',1,5,'paper','h');"
    )
    old.commit()
    old.close()
    Store(path).close()
    row = sqlite3.connect(path).execute("SELECT model, prompt, pipeline FROM verdicts").fetchone()
    assert row == ("legacy", "legacy", "legacy")
    assert sqlite3.connect(path).execute("SELECT content_hash FROM items").fetchone()[0] != ""


def _titled(item_id, title):
    return Item(
        item_id, "s", "paper", title, "S", "https://e.com/" + item_id, [], "2026-11-20T00:00:00Z"
    )


def test_the_same_article_under_a_second_id_is_never_classified_twice():
    store = Store(":memory:")
    title = "Scaling Test-Time Compute: A Careful Study of Reasoning Models"
    store.upsert_items([_titled("arxiv:1", title)], NOW)
    store.upsert_items([_titled("rss:2", title.upper() + "!")], NOW)  # case and punctuation differ
    assert [i.id for i in store.pending_classification()] == ["arxiv:1"]
    status = store._conn.execute("SELECT status FROM items WHERE id = 'rss:2'").fetchone()[0]
    assert status == "duplicate"


def test_duplicates_inside_one_batch_keep_only_the_first_and_short_titles_never_collide():
    store = Store(":memory:")
    long_title = "A reasonably long and specific article title"
    store.upsert_items(
        [
            _titled("a", long_title),
            _titled("b", long_title),
            _titled("c", "Introducing GPT"),
            _titled("d", "Introducing GPT"),
        ],
        NOW,
    )
    assert sorted(i.id for i in store.pending_classification()) == ["a", "c", "d"]


def test_a_known_item_is_never_turned_into_a_duplicate_when_seen_again():
    store = Store(":memory:")
    title = "A reasonably long and specific article title"
    store.upsert_items([_titled("a", title)], NOW)
    store.save_verdicts([verdict("a")])
    store.upsert_items([_titled("a", title)], NOW)
    assert (
        store._conn.execute("SELECT status FROM items WHERE id = 'a'").fetchone()[0]
        == "interesting"
    )


def _stale_store():
    """a: published under model A; b: rejected under A; c: published under legacy."""
    store = Store(":memory:")
    items = [
        _titled("a", "Article a with a long enough title"),
        _titled("b", "Article b with a long enough title"),
        _titled("c", "Article c with a long enough title"),
    ]
    store.upsert_items(items, NOW)
    old = _prov("A", "p", "1.0.0")
    store.save_verdicts([verdict("a")], old)
    store.save_verdicts([Verdict("b", False, 2, "paper", "h")], old)
    store.save_verdicts([verdict("c")])  # legacy
    store.save_enrichments([Enrichment("a", "Agents", "Old hook.", "Old brief.")], old)
    store.save_enrichments([Enrichment("c", "Agents", "H.", "B.")])
    return store


def test_stale_classification_lists_outdated_results_but_never_legacy_ones():
    store = _stale_store()
    current = _prov("B", "p", "1.0.0")
    assert sorted(i.id for i in store.stale_classification(current, 10)) == ["a", "b"]
    assert store.stale_classification(_prov("A", "p", "1.0.7"), 10) == []  # patch: same results


def test_stale_classification_respects_the_limit_and_the_current_version_is_not_stale():
    store = _stale_store()
    assert len(store.stale_classification(_prov("B", "p", "1.0.0"), 1)) == 1
    assert store.stale_classification(_prov("A", "p", "1.0.0"), 10) == []


def test_refresh_verdict_keeps_a_published_item_published_and_revives_a_rejected_one():
    store = _stale_store()
    new = _prov("B", "p", "1.0.0")
    store.refresh_verdict(Verdict("a", False, 3, "news", "x"), new)  # now "not interesting"
    store.refresh_verdict(Verdict("b", True, 8, "paper", "y"), new)
    status = dict(store._conn.execute("SELECT id, status FROM items"))
    assert status["a"] == "published" and status["b"] == "interesting"  # never unpublished
    row = store._conn.execute(
        "SELECT score, type, model FROM verdicts WHERE item_id='a'"
    ).fetchone()
    assert row == (3, "news", "B")


def test_stale_hooks_and_refresh_keep_the_category_that_consolidation_chose():
    store = _stale_store()
    store.rename_category("Agents", "Consolidated")
    current = _prov("B", "hp", "1.0.0")
    stale = store.stale_hooks(current, 10)
    assert [(i.id, e.category) for i, _, e in stale] == [("a", "Consolidated")]
    store.refresh_enrichment("a", "New hook.", "New brief.", current)
    (row,) = [r for r in store.published_items("2026-01-01T00:00:00Z") if r["id"] == "a"]
    assert (row["hook"], row["brief"], row["category"]) == (
        "New hook.",
        "New brief.",
        "Consolidated",
    )
    assert store.stale_hooks(current, 10) == []


def publish(store, it, type_="paper"):
    store.upsert_items([it], NOW)
    store.save_verdicts([Verdict(it.id, True, 7, type_, "h")])
    store.save_enrichments([Enrichment(it.id, "Agents", "Hook.")])


def repo(name: str, topics=("mcp", "agents"), stars=10) -> Item:
    return Item(
        f"github:{name}",
        "github",
        "github",
        name,
        "A repo",
        f"https://github.com/{name}",
        ["o"],
        "2026-11-20T10:00:00Z",
        github_stars=stars,
        topics=topics,
    )


def test_topics_are_stored_and_read_back(store):
    store.upsert_items([repo("o/r")], NOW)
    assert store.pending_classification()[0].topics == ("mcp", "agents")


def test_topic_counts_come_from_published_repos_only(store):
    publish(store, repo("o/a", ("mcp", "agents")), "github")
    publish(store, repo("o/b", ("mcp",)), "github")
    store.upsert_items([repo("o/unpublished", ("games",))], NOW)
    assert store.topic_counts("2026-11-01T00:00:00Z") == {"mcp": 2, "agents": 1}
    assert store.topic_counts("2026-11-21T00:00:00Z") == {}


def test_mentions_are_exported_with_the_item_most_points_first(store):
    publish(store, item("a"))
    store.save_mentions(
        [
            Mention("a", "https://news.ycombinator.com/item?id=1", "Low", 120, NOW),
            Mention("a", "https://news.ycombinator.com/item?id=2", "High", 400, NOW),
        ]
    )
    (exported,) = store.published_items("2026-01-01T00:00:00Z")
    assert exported["mentions"] == [
        {"title": "High", "url": "https://news.ycombinator.com/item?id=2", "points": 400},
        {"title": "Low", "url": "https://news.ycombinator.com/item?id=1", "points": 120},
    ]


def test_saving_a_mention_again_only_ever_raises_its_points(store):
    publish(store, item("a"))
    url = "https://news.ycombinator.com/item?id=1"
    store.save_mentions([Mention("a", url, "T", 300, NOW)])
    store.save_mentions([Mention("a", url, "T", 100, NOW), Mention("a", url, "T", 350, NOW)])
    assert store.published_items("2026-01-01T00:00:00Z")[0]["mentions"][0]["points"] == 350


def test_an_item_without_mentions_exports_an_empty_list(store):
    publish(store, item("a"))
    assert store.published_items("2026-01-01T00:00:00Z")[0]["mentions"] == []
