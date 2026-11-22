"""Dynamic categories and hooks for interesting items."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from veille_llm.llm import (
    DEFAULT_MODEL,
    LlmError,
    LlmOutputError,
    Runner,
    complete_json,
    redact,
)
from veille_llm.models import LEGACY, Enrichment, Provenance
from veille_llm.pipeline.classify import BATCH_SIZE, SUMMARY_MAX
from veille_llm.pipeline.resilient import with_halves
from veille_llm.store import Store

MAX_CATEGORIES = 12
FALLBACK_CATEGORY = "Other"
HOOK_MAX = 160
BRIEF_MAX = 400

ENRICH_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string", "minLength": 1, "maxLength": 120},
                    "hook": {"type": "string", "maxLength": 400},
                    "brief": {"type": "string", "maxLength": 600},
                },
                "required": ["id", "category", "hook", "brief"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You write the entries of a personal watch on LLM research and news. For each item in the "
    "data, choose a category: reuse one of existing_categories whenever it fits, and only create "
    "a new short category (at most 3 words) when none fits. Then write a hook: one or two very "
    "short sentences (at most 120 characters) that make the reader want to open the item, "
    "without lying, exaggerating or promising what the item does not deliver. Then write a "
    "brief: two or three plain sentences (at most 300 characters) saying what the item is and "
    "finds, in your own words. Hook and brief use no link, no markup and no hype, and they do "
    'not repeat each other. Return one entry per item as {"items": [{"id": ..., '
    '"category": ..., "hook": ..., "brief": ...}]}, using the same id.'
)


CAP_REACHED = (
    f" The limit of {MAX_CATEGORIES} categories is reached: do not create any new category. "
    f'Pick the closest of existing_categories, and use "{FALLBACK_CATEGORY}" only when none fits.'
)


def instructions_for(at_cap: bool) -> str:
    return INSTRUCTIONS + (CAP_REACHED if at_cap else "")


@dataclass
class EnrichOutcome:
    enriched: int = 0
    skipped_batches: int = 0
    skip_reasons: list[str] = field(default_factory=list)
    stopped: str | None = None
    capped: bool = False


CATEGORY_MAX = 40


def _category_is_safe(name: str) -> bool:
    """Letters, digits, spaces, hyphen and slash only: no markup, domain or link."""
    lowered = name.lower()
    return (
        bool(name)
        and name[0].isalnum()
        and all(ch.isalnum() or ch in " /-" for ch in name)
        and "http" not in lowered
        and "www" not in lowered
    )


def normalise_category(name: str, existing: list[str]) -> str:
    cleaned = " ".join(name.split())[:CATEGORY_MAX].strip()
    if not _category_is_safe(cleaned):
        return FALLBACK_CATEGORY
    for known in existing:
        if known.casefold() == cleaned.casefold():
            return known
    if len([c for c in existing if c != FALLBACK_CATEGORY]) < MAX_CATEGORIES:
        return cleaned[0].upper() + cleaned[1:]
    return FALLBACK_CATEGORY


def hook_is_safe(hook: str, limit: int = HOOK_MAX) -> bool:
    text = hook.strip()
    return (
        bool(text)
        and len(text) <= limit
        and not any(marker in text.lower() for marker in ("http", "<", ">"))
    )


async def enrich_pending(
    store: Store,
    *,
    runner: Runner | None = None,
    model: str = DEFAULT_MODEL,
    max_batches: int | None = None,
    on_batch: Callable[[int, int], None] | None = None,
    since: str = "0000-01-01T00:00:00Z",
    provenance: Provenance = LEGACY,
) -> EnrichOutcome:
    outcome = EnrichOutcome()
    pending = store.pending_enrichment()
    total = -(-len(pending) // BATCH_SIZE)
    if max_batches is not None:
        total = min(total, max_batches)
    for start in range(0, len(pending), BATCH_SIZE):
        if max_batches is not None and start // BATCH_SIZE >= max_batches:
            outcome.capped = True
            break
        batch = pending[start : start + BATCH_SIZE]
        # Only categories in use inside the window: an empty one frees its slot.
        known = [name for name, _ in store.category_usage(since)]
        at_cap = len([c for c in known if c != FALLBACK_CATEGORY]) >= MAX_CATEGORIES

        async def write(part: list, known: list[str] = known, at_cap: bool = at_cap) -> list:
            data = {
                "existing_categories": known,
                "items": [
                    {
                        "id": item.id,
                        "title": item.title,
                        "summary": item.summary[:SUMMARY_MAX],
                        "category_hint": verdict.category_hint,
                    }
                    for item, verdict in part
                ],
            }
            result = await complete_json(
                instructions_for(at_cap), ENRICH_SCHEMA, data=data, model=model, runner=runner
            )
            wanted = {item.id for item, _ in part}
            seen: set[str] = set()
            written = []
            for entry in result.data["items"]:
                if (
                    entry["id"] not in wanted
                    or entry["id"] in seen
                    or not hook_is_safe(entry["hook"])
                    or not hook_is_safe(entry["brief"], BRIEF_MAX)
                ):
                    continue
                seen.add(entry["id"])
                category = normalise_category(entry["category"], known)
                if category not in known:
                    known.append(category)
                written.append(
                    Enrichment(entry["id"], category, entry["hook"].strip(), entry["brief"].strip())
                )
            return written

        try:
            enrichments = await with_halves(batch, write, outcome)
        except LlmError as exc:
            outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
            break
        store.save_enrichments(enrichments, provenance)
        outcome.enriched += len(enrichments)
        if on_batch:
            on_batch(start // BATCH_SIZE + 1, total)
    return outcome


async def refresh_stale_hooks(
    store: Store,
    *,
    provenance: Provenance,
    runner: Runner | None = None,
    model: str = DEFAULT_MODEL,
    max_batches: int,
) -> EnrichOutcome:
    """Rewrite hooks and briefs made under another model, prompt or minor pipeline version.

    The category is never touched (consolidation may have chosen it); a hook that fails the
    safety checks leaves the previous, published one in place.
    """
    outcome = EnrichOutcome()
    stale = store.stale_hooks(provenance, max_batches * BATCH_SIZE)
    for start in range(0, len(stale), BATCH_SIZE):
        batch = stale[start : start + BATCH_SIZE]
        data = {
            "existing_categories": sorted({e.category for _, _, e in batch}),
            "items": [
                {
                    "id": item.id,
                    "title": item.title,
                    "summary": item.summary[:SUMMARY_MAX],
                    "category_hint": enrichment.category,
                }
                for item, _, enrichment in batch
            ],
        }
        try:
            result = await complete_json(
                instructions_for(True), ENRICH_SCHEMA, data=data, model=model, runner=runner
            )
        except LlmOutputError as exc:
            outcome.skipped_batches += 1
            outcome.skip_reasons.append(redact(str(exc))[:200])
            continue
        except LlmError as exc:
            outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
            break
        wanted = {item.id for item, _, _ in batch}
        seen: set[str] = set()
        for entry in result.data["items"]:
            if (
                entry["id"] not in wanted
                or entry["id"] in seen
                or not hook_is_safe(entry["hook"])
                or not hook_is_safe(entry["brief"], BRIEF_MAX)
            ):
                continue
            seen.add(entry["id"])
            store.refresh_enrichment(
                entry["id"], entry["hook"].strip(), entry["brief"].strip(), provenance
            )
            outcome.enriched += 1
    return outcome
