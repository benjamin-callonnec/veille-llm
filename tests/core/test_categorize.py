import asyncio
import json

from veille_llm.llm import LlmLimitError, RawReply
from veille_llm.models import Item, Verdict
from veille_llm.pipeline.categorize import (
    FALLBACK_CATEGORY,
    MAX_CATEGORIES,
    enrich_pending,
    hook_is_safe,
    normalise_category,
)
from veille_llm.store import Store

NOW = "2026-11-21T12:00:00Z"


def seeded(n=1):
    store = Store(":memory:")
    items = [
        Item(
            f"i{k:02d}",
            "src",
            "paper",
            f"Title {k}",
            "Summary",
            "https://e.com",
            [],
            "2026-11-20T10:00:00Z",
        )
        for k in range(n)
    ]
    store.upsert_items(items, NOW)
    store.save_verdicts([Verdict(i.id, True, 8, "paper", "hint") for i in items])
    return store


def reply(entries):
    return RawReply(json.dumps({"items": entries}), 1, 1, None)


def prompt_data(prompt):
    return json.loads(prompt.split("<data>")[1].split("</data>")[0])


def test_normalise_reuses_existing_name_ignoring_case():
    assert normalise_category("  state   SPACE ", ["State space", "Agents"]) == "State space"


def test_normalise_creates_a_new_category_below_the_cap():
    assert normalise_category("reasoning models", ["Agents"]) == "Reasoning models"


def test_normalise_falls_back_to_autres_at_the_cap():
    existing = [f"Cat {k}" for k in range(MAX_CATEGORIES)]
    assert normalise_category("Brand new", existing) == FALLBACK_CATEGORY
    assert normalise_category("cat 3", existing) == "Cat 3"


def test_hook_is_safe_rejects_urls_angle_brackets_empty_and_long_hooks():
    assert hook_is_safe("A short and useful hook.")
    assert not hook_is_safe("")
    assert not hook_is_safe("See http://evil.example now")
    assert not hook_is_safe("Click <b>here</b>")
    assert not hook_is_safe("x" * 201)


def test_enrich_pending_saves_category_and_hook():
    store = seeded(1)

    async def run(prompt, options):
        return reply([{"id": "i00", "category": "state space", "hook": "Why it matters."}])

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 1
    (published,) = store.published_items("2026-01-01T00:00:00Z")
    assert (published["category"], published["hook"]) == ("State space", "Why it matters.")


def test_enrich_pending_leaves_item_with_unsafe_hook_unpublished():
    store = seeded(2)

    async def run(prompt, options):
        return reply(
            [
                {"id": "i00", "category": "Agents", "hook": "Visit http://evil.example"},
                {"id": "i01", "category": "Agents", "hook": "A fine hook."},
            ]
        )

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 1
    assert [p["id"] for p in store.published_items("2026-01-01T00:00:00Z")] == ["i01"]
    assert [i.id for i, _ in store.pending_enrichment()] == ["i00"]


def test_enrich_pending_sends_existing_categories_to_the_llm():
    store = seeded(1)
    store.upsert_items([], NOW)
    store._conn.execute("INSERT INTO categories VALUES ('Agents')")
    seen = []

    async def run(prompt, options):
        seen.append(prompt_data(prompt))
        return reply([{"id": "i00", "category": "agents", "hook": "Hook."}])

    asyncio.run(enrich_pending(store, runner=run))
    assert seen[0]["existing_categories"] == ["Agents"]
    assert seen[0]["items"][0]["id"] == "i00"
    assert store.category_names() == ["Agents"]


def test_enrich_pending_stops_on_limit_after_saving_previous_batches():
    store = seeded(31)
    calls = []

    async def run(prompt, options):
        calls.append(1)
        if len(calls) == 3:
            raise LlmLimitError("usage limit reached")
        ids = [d["id"] for d in prompt_data(prompt)["items"]]
        return reply([{"id": i, "category": "Agents", "hook": "Hook."} for i in ids])

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 30
    assert outcome.stopped.startswith("LlmLimitError")
    assert len(store.pending_enrichment()) == 1
