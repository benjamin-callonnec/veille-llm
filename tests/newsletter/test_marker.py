import sqlite3

from veille_llm.store import Store


def test_progress_is_none_until_a_delivery_is_recorded():
    assert Store(":memory:").newsletter_progress("2026-W48") is None


def test_record_delivery_upserts_counts():
    store = Store(":memory:")
    store.record_delivery("2026-W48", delivered=2, total=5)
    assert store.newsletter_progress("2026-W48") == (2, 5)
    store.record_delivery("2026-W48", delivered=5, total=5)
    assert store.newsletter_progress("2026-W48") == (5, 5)


def test_the_marker_stores_counts_only_never_addresses(tmp_path):
    path = tmp_path / "v.db"
    store = Store(path)
    store.record_delivery("2026-W48", delivered=1, total=1)
    store.close()
    columns = [r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(newsletter)")]
    assert columns == ["week", "delivered", "total"]
