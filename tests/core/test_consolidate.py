import asyncio
import json

from veille_llm.llm import LlmLimitError, RawReply
from veille_llm.models import Enrichment, Item, Verdict
from veille_llm.pipeline.categorize import MAX_CATEGORIES
from veille_llm.pipeline.consolidate import MIN_ITEMS, OTHER_SHARE, consolidate
from veille_llm.store import Store

NOW = "2026-11-21T12:00:00Z"
SINCE = "2026-11-01T00:00:00Z"


def build(rows):
    """rows: (id, category) all published 2026-11-20."""
    store = Store(":memory:")
    items = [
        Item(i, "s", "paper", f"Title {i}", "S", "https://e.com", [], "2026-11-20T00:00:00Z")
        for i, _ in rows
    ]
    store.upsert_items(items, NOW)
    store.save_verdicts([Verdict(i.id, True, 5, "paper", "h") for i in items])
    store.save_enrichments([Enrichment(i, c, f"Hook {i}.", "B.") for i, c in rows])
    return store


def many_other(extra=()):
    rows = [(f"o{k:02d}", "Other") for k in range(8)] + [(f"a{k:02d}", "Agents") for k in range(4)]
    return build([*rows, *extra])


def answer(merges=(), assignments=()):
    async def run(prompt, options):
        run.calls += 1
        run.data = json.loads(prompt.split("<data>")[1].split("</data>")[0])
        return RawReply(
            json.dumps({"merges": list(merges), "assignments": list(assignments)}), 1, 1, None
        )

    run.calls = 0
    return run


def usage(store):
    return dict(store.category_usage(SINCE))


def test_constants():
    assert MIN_ITEMS == 10 and OTHER_SHARE == 0.25


def test_no_llm_call_when_other_is_a_small_share():
    store = build([(f"a{k}", "Agents") for k in range(11)] + [("o", "Other")])
    run = answer()
    outcome = asyncio.run(consolidate(store, runner=run, since=SINCE))
    assert run.calls == 0 and outcome.skipped


def test_no_llm_call_when_there_are_too_few_items():
    store = build([("o1", "Other"), ("o2", "Other"), ("a", "Agents")])
    run = answer()
    assert asyncio.run(consolidate(store, runner=run, since=SINCE)).skipped and run.calls == 0


def test_assigns_other_items_to_existing_and_new_broad_categories():
    store = many_other()
    run = answer(
        assignments=[
            {"id": "o00", "category": "agents"},
            {"id": "o01", "category": "Model architectures"},
        ]
    )
    outcome = asyncio.run(consolidate(store, runner=run, since=SINCE))
    assert outcome.reassigned == 2
    assert usage(store) == {"Agents": 5, "Model architectures": 1, "Other": 6}
    assert {i["id"] for i in run.data["other_items"]} >= {"o00", "o01"}


def test_merges_a_tiny_category_into_a_bigger_one_and_frees_a_slot():
    store = many_other([("t1", "Tiny topic")])
    run = answer(merges=[{"from": "Tiny topic", "to": "Agents"}])
    outcome = asyncio.run(consolidate(store, runner=run, since=SINCE))
    assert outcome.merged == 1 and "Tiny topic" not in usage(store) and usage(store)["Agents"] == 5


def test_merge_into_other_or_from_unknown_or_unsafe_names_is_ignored():
    store = many_other()
    run = answer(
        merges=[
            {"from": "Agents", "to": "Other"},
            {"from": "Ghost", "to": "Agents"},
            {"from": "Agents", "to": "<b>x</b>"},
            {"from": "Agents", "to": "see evil.com"},
        ]
    )
    asyncio.run(consolidate(store, runner=run, since=SINCE))
    assert usage(store)["Agents"] == 4


def test_cannot_move_items_that_are_not_in_other_and_unknown_ids_are_ignored():
    store = many_other()
    run = answer(
        assignments=[
            {"id": "a00", "category": "Security"},
            {"id": "nope", "category": "Security"},
            {"id": "o00", "category": "Other"},
        ]
    )
    outcome = asyncio.run(consolidate(store, runner=run, since=SINCE))
    assert outcome.reassigned == 0 and usage(store)["Agents"] == 4


def test_the_category_cap_holds_after_consolidation():
    rows = [(f"o{k:02d}", "Other") for k in range(8)]
    rows += [(f"c{k}", f"Cat {k}") for k in range(MAX_CATEGORIES)]
    store = build(rows)
    run = answer(assignments=[{"id": "o00", "category": "Brand new"}])
    outcome = asyncio.run(consolidate(store, runner=run, since=SINCE))
    assert outcome.reassigned == 0 and usage(store)["Other"] == 8


def test_a_limit_error_stops_without_changes_and_bad_output_is_skipped():
    store = many_other()

    async def limit(prompt, options):
        raise LlmLimitError("usage limit reached")

    outcome = asyncio.run(consolidate(store, runner=limit, since=SINCE))
    assert outcome.stopped and usage(store)["Other"] == 8

    async def garbage(prompt, options):
        return RawReply("not json", 1, 1, None)

    again = asyncio.run(consolidate(store, runner=garbage, since=SINCE))
    assert again.stopped is None and again.skipped and usage(store)["Other"] == 8
