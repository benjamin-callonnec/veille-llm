import pytest

from veille_reader.storage import MAX_HTML_CHARS, MAX_VERSIONS, ReaderStore


@pytest.fixture
def store(tmp_path):
    return ReaderStore(tmp_path / "data")


def test_save_creates_report_v1(store):
    saved = store.save_report("a1", "Deck", "<p>1</p>")
    assert saved == {"id": saved["id"], "version": 1, "title": "Deck"}
    assert store.reports("a1")[0]["title"] == "Deck"


def test_save_with_id_adds_version_and_can_retitle(store):
    first = store.save_report("a1", "Deck", "<p>1</p>")
    second = store.save_report("a1", "Deck 2", "<p>2</p>", first["id"])
    assert second["version"] == 2 and second["id"] == first["id"]
    assert store.reports("a1") == [
        {
            "id": first["id"],
            "title": "Deck 2",
            "version": 2,
            "updated_at": store.report("a1", first["id"])["versions"][-1]["created_at"],
        }
    ]


def test_report_returns_latest_by_default_and_a_given_version(store):
    r = store.save_report("a1", "Deck", "<p>1</p>")
    store.save_report("a1", "Deck", "<p>2</p>", r["id"])
    assert store.report("a1", r["id"])["html"] == "<p>2</p>"
    old = store.report("a1", r["id"], 1)
    assert old["html"] == "<p>1</p>" and old["version"] == 1
    assert [v["version"] for v in old["versions"]] == [1, 2]


def test_unknown_report_or_version_returns_none(store):
    r = store.save_report("a1", "Deck", "<p>1</p>")
    assert store.report("a1", r["id"], 9) is None
    assert store.report("a1", 999) is None


def test_restore_adds_a_copy_and_keeps_all_versions(store):
    r = store.save_report("a1", "Deck", "<p>1</p>")
    store.save_report("a1", "Deck", "<p>2</p>", r["id"])
    restored = store.restore_report("a1", r["id"], 1)
    assert restored["version"] == 3
    view = store.report("a1", r["id"])
    assert view["html"] == "<p>1</p>" and [v["version"] for v in view["versions"]] == [1, 2, 3]
    assert store.restore_report("a1", r["id"], 9) is None


def test_versions_purged_beyond_max_keeping_current(store):
    r = store.save_report("a1", "Deck", "<p>0</p>")
    for n in range(1, MAX_VERSIONS + 5):
        store.save_report("a1", "Deck", f"<p>{n}</p>", r["id"])
    view = store.report("a1", r["id"])
    versions = [v["version"] for v in view["versions"]]
    assert len(versions) == MAX_VERSIONS
    assert versions[-1] == MAX_VERSIONS + 5 and view["html"] == f"<p>{MAX_VERSIONS + 4}</p>"


def test_report_scoped_to_item(store):
    r = store.save_report("a1", "Deck", "<p>1</p>")
    assert store.report("b1", r["id"]) is None
    assert store.reports("b1") == []
    with pytest.raises(KeyError):
        store.save_report("b1", "x", "<p>x</p>", r["id"])
    assert store.delete_report("b1", r["id"]) is False
    assert store.restore_report("b1", r["id"], 1) is None


def test_delete_report_cascades(store):
    r = store.save_report("a1", "Deck", "<p>1</p>")
    assert store.delete_report("a1", r["id"]) is True
    assert store.report("a1", r["id"]) is None
    assert store._con.execute("SELECT COUNT(*) FROM report_versions").fetchone()[0] == 0


def test_save_rejects_oversized_html(store):
    with pytest.raises(ValueError):
        store.save_report("a1", "Deck", "x" * (MAX_HTML_CHARS + 1))
