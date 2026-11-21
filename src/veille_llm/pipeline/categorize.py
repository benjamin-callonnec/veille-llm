"""Dynamic categories and hooks for interesting items."""

from __future__ import annotations

from dataclasses import dataclass

from veille_llm.llm import LlmError, LlmOutputError, Runner, complete_json, redact
from veille_llm.models import Enrichment
from veille_llm.pipeline.classify import BATCH_SIZE, SUMMARY_MAX
from veille_llm.store import Store

MAX_CATEGORIES = 12
FALLBACK_CATEGORY = "Autres"
HOOK_MAX = 200

ENRICH_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string", "minLength": 1, "maxLength": 40},
                    "hook": {"type": "string", "maxLength": 400},
                },
                "required": ["id", "category", "hook"],
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
    "a new short category (at most 3 words) when none fits. Then write a hook: one or two plain "
    "sentences (at most 200 characters) saying why the item matters, with no link, no markup and "
    'no hype. Return one entry per item, using the same id: {"items": [...]}.'
)


@dataclass
class EnrichOutcome:
    enriched: int = 0
    skipped_batches: int = 0
    stopped: str | None = None


def normalise_category(name: str, existing: list[str]) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        return FALLBACK_CATEGORY
    for known in existing:
        if known.casefold() == cleaned.casefold():
            return known
    if len([c for c in existing if c != FALLBACK_CATEGORY]) < MAX_CATEGORIES:
        return cleaned[0].upper() + cleaned[1:]
    return FALLBACK_CATEGORY


def hook_is_safe(hook: str) -> bool:
    text = hook.strip()
    return (
        bool(text)
        and len(text) <= HOOK_MAX
        and not any(marker in text.lower() for marker in ("http", "<", ">"))
    )


async def enrich_pending(store: Store, *, runner: Runner | None = None) -> EnrichOutcome:
    outcome = EnrichOutcome()
    pending = store.pending_enrichment()
    for start in range(0, len(pending), BATCH_SIZE):
        batch = pending[start : start + BATCH_SIZE]
        known = store.category_names()
        data = {
            "existing_categories": known,
            "items": [
                {
                    "id": item.id,
                    "title": item.title,
                    "summary": item.summary[:SUMMARY_MAX],
                    "category_hint": verdict.category_hint,
                }
                for item, verdict in batch
            ],
        }
        try:
            result = await complete_json(INSTRUCTIONS, ENRICH_SCHEMA, data=data, runner=runner)
        except LlmOutputError:
            outcome.skipped_batches += 1
            continue
        except LlmError as exc:
            outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
            break
        wanted = {item.id for item, _ in batch}
        seen: set[str] = set()
        enrichments = []
        for entry in result.data["items"]:
            if entry["id"] not in wanted or entry["id"] in seen or not hook_is_safe(entry["hook"]):
                continue
            seen.add(entry["id"])
            category = normalise_category(entry["category"], known)
            if category not in known:
                known.append(category)
            enrichments.append(Enrichment(entry["id"], category, entry["hook"].strip()))
        store.save_enrichments(enrichments)
        outcome.enriched += len(enrichments)
    return outcome
