"""Tidy the categories: merge tiny ones and re-home the items parked in "Other".

Runs only when "Other" holds a large share of the window (the cap of categories filled up with
narrow names early on). One LLM call; the model only proposes, every name and id is validated
here, and the category cap is enforced by the same rule as for new items.
"""

from __future__ import annotations

from dataclasses import dataclass

from veille_llm.llm import (
    DEFAULT_MODEL,
    LlmError,
    LlmOutputError,
    Runner,
    complete_json,
    redact,
)
from veille_llm.pipeline.categorize import (
    CATEGORY_MAX,
    FALLBACK_CATEGORY,
    MAX_CATEGORIES,
    _category_is_safe,
    normalise_category,
)
from veille_llm.store import Store

MIN_ITEMS = 10
OTHER_SHARE = 0.25
OTHER_BATCH = 60

CONSOLIDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "merges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string", "maxLength": 120},
                    "to": {"type": "string", "maxLength": 120},
                },
                "required": ["from", "to"],
                "additionalProperties": False,
            },
        },
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string", "maxLength": 120},
                },
                "required": ["id", "category"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["merges", "assignments"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You tidy the categories of a personal watch on LLM research and news. In the data, "
    "categories lists each category with its item count, and other_items are items parked in "
    f'"{FALLBACK_CATEGORY}" (id, title, hook). First, merges: every category with fewer than 3 '
    "items, and every near duplicate, must be merged into a broader existing or new category "
    "unless it is clearly distinct and likely to grow. Second, assignments: give each "
    "other_item the best category, either "
    "an existing one or a new broad one (at most 3 words, reusable for many future items, never "
    "a narrow topic); leave an item out when nothing fits. "
    f"After your changes there must be at most {MAX_CATEGORIES} categories besides "
    f'"{FALLBACK_CATEGORY}": broad beats narrow. Return {{"merges": [{{"from": ..., "to": ...}}], '
    '"assignments": [{"id": ..., "category": ...}]}.'
)


@dataclass
class ConsolidateOutcome:
    skipped: bool = False
    merged: int = 0
    reassigned: int = 0
    stopped: str | None = None


async def consolidate(
    store: Store,
    *,
    since: str,
    runner: Runner | None = None,
    model: str = DEFAULT_MODEL,
) -> ConsolidateOutcome:
    outcome = ConsolidateOutcome()
    usage = store.category_usage(since)
    total = sum(count for _, count in usage)
    other = dict(usage).get(FALLBACK_CATEGORY, 0)
    if total < MIN_ITEMS or other / total <= OTHER_SHARE:
        outcome.skipped = True
        return outcome

    parked = store.other_items(since, OTHER_BATCH)
    data = {
        "categories": [{"name": n, "count": c} for n, c in usage if n != FALLBACK_CATEGORY],
        "other_items": parked,
    }
    try:
        result = await complete_json(
            INSTRUCTIONS, CONSOLIDATE_SCHEMA, data=data, model=model, runner=runner
        )
    except LlmOutputError:
        outcome.skipped = True
        return outcome
    except LlmError as exc:
        outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
        return outcome

    names = [n for n, _ in usage]
    for merge in result.data["merges"]:
        source, target = merge["from"], " ".join(merge["to"].split())[:CATEGORY_MAX].strip()
        if source not in names or source == FALLBACK_CATEGORY or not _category_is_safe(target):
            continue
        if (
            target.casefold() == FALLBACK_CATEGORY.casefold()
            or target.casefold() == source.casefold()
        ):
            continue
        others = [n for n in names if n != source]
        resolved = normalise_category(target, others)  # existing name, or new below the cap
        if resolved == FALLBACK_CATEGORY:
            continue
        store.rename_category(source, resolved)
        names = others if resolved in others else [*others, resolved]
        outcome.merged += 1

    parked_ids = {item["id"] for item in parked}
    for assignment in result.data["assignments"]:
        if assignment["id"] not in parked_ids:
            continue
        resolved = normalise_category(assignment["category"], names)
        if resolved == FALLBACK_CATEGORY:
            continue
        if store.reassign_other(assignment["id"], resolved):
            outcome.reassigned += 1
            if resolved not in names:
                names.append(resolved)
    return outcome
