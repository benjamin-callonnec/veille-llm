import json
from datetime import UTC, datetime

from veille_llm.models import Enrichment, Item, Verdict
from veille_llm.pipeline.export import export_catalogue
from veille_llm.store import Store

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)
STAMP = "2026-11-21T12:00:00Z"


def seeded(
    published=(
        ("a", "2026-11-18T00:00:00Z", "Agents"),
        ("b", "2026-11-20T00:00:00Z", "Agents"),
        ("c", "2026-11-19T00:00:00Z", "State space"),
    ),
):
    store = Store(":memory:")
    items = [Item(i, "src", "paper", f"T{i}", "S", "https://e.com", [], p) for i, p, _ in published]
    store.upsert_items(items, STAMP)
    store.save_verdicts([Verdict(i.id, True, 5, "paper", "h") for i in items])
    store.save_enrichments([Enrichment(i, c, "Hook.") for i, _, c in published])
    return store


def test_export_contains_only_published_items(tmp_path):
    store = seeded()
    store.upsert_items(
        [Item("raw", "src", "news", "T", "S", "u", [], "2026-11-20T00:00:00Z")], STAMP
    )
    out = tmp_path / "catalogue.json"
    assert export_catalogue(store, out, now=NOW)
    ids = [i["id"] for i in json.loads(out.read_text())["items"]]
    assert "raw" not in ids and set(ids) == {"a", "b", "c"}


def test_export_counts_categories(tmp_path):
    out = tmp_path / "catalogue.json"
    export_catalogue(seeded(), out, now=NOW)
    cats = json.loads(out.read_text())["categories"]
    assert cats == [{"name": "Agents", "count": 2}, {"name": "State space", "count": 1}]


def test_export_is_sorted_newest_first(tmp_path):
    out = tmp_path / "catalogue.json"
    export_catalogue(seeded(), out, now=NOW)
    assert [i["id"] for i in json.loads(out.read_text())["items"]] == ["b", "c", "a"]


def test_export_never_overwrites_a_previous_file_with_an_empty_catalogue(tmp_path):
    out = tmp_path / "catalogue.json"
    out.write_text('{"previous": true}')
    assert export_catalogue(Store(":memory:"), out, now=NOW) is False
    assert json.loads(out.read_text()) == {"previous": True}


def test_export_writes_an_empty_catalogue_when_no_previous_file(tmp_path):
    out = tmp_path / "build" / "catalogue.json"
    assert export_catalogue(Store(":memory:"), out, now=NOW) is True
    data = json.loads(out.read_text())
    assert data["items"] == [] and data["categories"] == []
    assert data["generated_at"] == STAMP


def test_export_is_atomic(tmp_path):
    out = tmp_path / "catalogue.json"
    export_catalogue(seeded(), out, now=NOW)
    assert [p.name for p in tmp_path.iterdir()] == ["catalogue.json"]
