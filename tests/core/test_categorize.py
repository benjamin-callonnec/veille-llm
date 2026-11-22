import asyncio
import json

from veille_llm.llm import LlmLimitError, RawReply
from veille_llm.models import Enrichment, Item, Verdict
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
    assert not hook_is_safe("x" * 161)


def test_enrich_pending_saves_category_and_hook():
    store = seeded(1)

    async def run(prompt, options):
        return reply(
            [
                {
                    "id": "i00",
                    "category": "state space",
                    "hook": "Why it matters.",
                    "brief": "A brief.",
                }
            ]
        )

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 1
    (published,) = store.published_items("2026-01-01T00:00:00Z")
    assert (published["category"], published["hook"]) == ("State space", "Why it matters.")


def test_enrich_pending_leaves_item_with_unsafe_hook_unpublished():
    store = seeded(2)

    async def run(prompt, options):
        return reply(
            [
                {
                    "id": "i00",
                    "category": "Agents",
                    "hook": "Visit http://evil.example",
                    "brief": "B.",
                },
                {"id": "i01", "category": "Agents", "hook": "A fine hook.", "brief": "B."},
            ]
        )

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 1
    assert [p["id"] for p in store.published_items("2026-01-01T00:00:00Z")] == ["i01"]
    assert [i.id for i, _ in store.pending_enrichment()] == ["i00"]


def test_enrich_pending_sends_existing_categories_to_the_llm():
    store = seeded(2)
    store.save_enrichments([Enrichment("i01", "Agents", "H.", "B.")])  # i01 is now published
    seen = []

    async def run(prompt, options):
        seen.append(prompt_data(prompt))
        return reply([{"id": "i00", "category": "agents", "hook": "Hook.", "brief": "B."}])

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
        return reply([{"id": i, "category": "Agents", "hook": "Hook.", "brief": "B."} for i in ids])

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 30
    assert outcome.stopped.startswith("LlmLimitError")
    assert len(store.pending_enrichment()) == 1


def test_normalise_rejects_markup_and_domains_in_categories():
    assert normalise_category("<img src=x onerror=alert(1)>", []) == FALLBACK_CATEGORY
    assert normalise_category("see evil.com", []) == FALLBACK_CATEGORY
    assert normalise_category("visit www home", []) == FALLBACK_CATEGORY
    assert normalise_category("Agents & tools", []) == FALLBACK_CATEGORY
    assert normalise_category("Reasoning / Planning", []) == "Reasoning / Planning"
    assert normalise_category("Mémoire longue-durée", []) == "Mémoire longue-durée"


def test_overlong_category_is_truncated_not_rejected_by_the_schema():
    store = seeded(1)

    async def run(prompt, options):
        return reply([{"id": "i00", "category": "word " * 14, "hook": "Hook.", "brief": "B."}])

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 1
    assert len(store.category_names()[0]) <= 40


def test_enrich_pending_saves_the_brief_next_to_the_hook():
    store = seeded(1)

    async def run(prompt, options):
        return reply(
            [{"id": "i00", "category": "Agents", "hook": "Hook.", "brief": "What it does."}]
        )

    asyncio.run(enrich_pending(store, runner=run))
    (published,) = store.published_items("2026-01-01T00:00:00Z")
    assert published["brief"] == "What it does."


def test_enrich_pending_rejects_an_unsafe_or_empty_brief():
    store = seeded(3)

    async def run(prompt, options):
        return reply(
            [
                {"id": "i00", "category": "A", "hook": "Hook.", "brief": "See http://x.example"},
                {"id": "i01", "category": "A", "hook": "Hook.", "brief": "  "},
                {"id": "i02", "category": "A", "hook": "Hook.", "brief": "Fine."},
            ]
        )

    outcome = asyncio.run(enrich_pending(store, runner=run))
    assert outcome.enriched == 1
    assert [p["id"] for p in store.published_items("2026-01-01T00:00:00Z")] == ["i02"]


def test_enrichment_offers_only_categories_used_inside_the_window():
    store = seeded(2)
    store.upsert_items(
        [Item("old", "s", "paper", "T", "S", "https://e.com", [], "2026-01-01T00:00:00Z")], NOW
    )
    store.save_verdicts([Verdict("old", True, 5, "paper", "h")])
    store.save_enrichments([Enrichment("old", "Ancient topic", "H.", "B.")])
    seen = {}

    async def run(prompt, options):
        seen.update(prompt_data(prompt))
        return reply([{"id": "i00", "category": "A", "hook": "H.", "brief": "B."}] * 0)

    asyncio.run(enrich_pending(store, runner=run, since="2026-11-01T00:00:00Z"))
    assert "Ancient topic" not in seen["existing_categories"]


def test_prompt_forbids_new_categories_once_the_cap_is_reached_and_allows_them_before():
    prompts = []

    async def run(prompt, options):
        prompts.append(prompt)
        return reply([])

    full = seeded(1)
    for k in range(MAX_CATEGORIES):
        full.upsert_items(
            [Item(f"e{k}", "s", "paper", "T", "S", "https://e.com", [], "2026-11-20T00:00:00Z")],
            NOW,
        )
        full.save_verdicts([Verdict(f"e{k}", True, 5, "paper", "h")])
        full.save_enrichments([Enrichment(f"e{k}", f"Cat {k}", "H.", "B.")])
    asyncio.run(enrich_pending(full, runner=run, since="2026-11-01T00:00:00Z"))
    asyncio.run(enrich_pending(seeded(1), runner=run, since="2026-11-01T00:00:00Z"))
    assert "do not create any new category" in prompts[0].lower()
    assert "do not create any new category" not in prompts[1].lower()
