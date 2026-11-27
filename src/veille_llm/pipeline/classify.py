"""LLM classification in small batches, each batch saved as soon as it is done."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from veille_llm.conferences import prioritise
from veille_llm.llm import (
    DEFAULT_MODEL,
    LlmError,
    LlmOutputError,
    Runner,
    complete_json,
    redact,
)
from veille_llm.models import LEGACY, Item, Provenance, Verdict
from veille_llm.pipeline.resilient import with_halves
from veille_llm.store import Store

BATCH_SIZE = 15
SUMMARY_MAX = 1200

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "interesting": {"type": "boolean"},
                    "score": {"type": "integer", "minimum": 0, "maximum": 10},
                    "type": {"enum": ["paper", "news", "benchmark"]},
                    "category_hint": {"type": "string", "maxLength": 80},
                },
                "required": ["id", "interesting", "score", "type", "category_hint"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You triage items for a personal watch on LLM research and news: model architectures "
    "(transformers and alternatives), training and inference methods, agents, reasoning, "
    "retrieval and knowledge graphs, benchmarks, and public announcements from AI labs. "
    "Items of kind github are repositories: they are interesting only when they help build or "
    "use LLM agents (agent harnesses, coding agents, MCP servers, agent skills, prompts and "
    "tooling for Claude Code and similar); reject any other repository however popular "
    "(games, generic web or Java frameworks, unrelated libraries). "
    "For each item in the data, decide if it is interesting for that watch, give it a score "
    "from 0 (irrelevant) to 10 (essential), a type (paper, news or benchmark) and a short "
    "category_hint (at most 40 characters, a few words). Return one entry per item as "
    '{"items": [{"id": ..., "interesting": true or false, "score": 0-10, '
    '"type": "paper"|"news"|"benchmark", "category_hint": ...}]}, using the same id.'
)


@dataclass
class ClassifyOutcome:
    classified: int = 0
    skipped_batches: int = 0
    skip_reasons: list[str] = field(default_factory=list)
    stopped: str | None = None
    capped: bool = False


def _entry(item: Item) -> dict:
    entry = {
        "id": item.id,
        "title": item.title,
        "summary": item.summary[:SUMMARY_MAX],
        "source": item.source,
        "kind": item.kind,
    }
    if item.kind == "github":
        entry.update(topics=list(item.topics), github_stars=item.github_stars)
    return entry


async def classify_batch(
    items: list[Item], *, runner: Runner | None = None, model: str = DEFAULT_MODEL
) -> list[Verdict]:
    data = [_entry(i) for i in items]
    result = await complete_json(
        INSTRUCTIONS, CLASSIFY_SCHEMA, data=data, model=model, runner=runner
    )
    known = {i.id for i in items}
    repos = {i.id for i in items if i.kind == "github"}  # the section is decided by the kind
    seen: set[str] = set()
    verdicts = []
    for entry in result.data["items"]:
        if entry["id"] not in known or entry["id"] in seen:
            continue
        seen.add(entry["id"])
        verdicts.append(
            Verdict(
                item_id=entry["id"],
                interesting=entry["interesting"],
                score=entry["score"],
                type="github" if entry["id"] in repos else entry["type"],
                category_hint=entry["category_hint"][:40],
            )
        )
    return verdicts


async def classify_pending(
    store: Store,
    *,
    runner: Runner | None = None,
    model: str = DEFAULT_MODEL,
    max_batches: int | None = None,
    on_batch: Callable[[int, int], None] | None = None,
    provenance: Provenance = LEGACY,
    now: datetime | None = None,
) -> ClassifyOutcome:
    outcome = ClassifyOutcome()
    pending = store.pending_classification()
    if now is not None:  # papers tied to an active conference go first, whatever their age
        pending = prioritise(pending, now)
    total = -(-len(pending) // BATCH_SIZE)
    if max_batches is not None:
        total = min(total, max_batches)
    for start in range(0, len(pending), BATCH_SIZE):
        if max_batches is not None and start // BATCH_SIZE >= max_batches:
            outcome.capped = True
            break
        batch = pending[start : start + BATCH_SIZE]
        try:
            verdicts = await with_halves(
                batch,
                lambda part: classify_batch(part, runner=runner, model=model),
                outcome,
            )
        except LlmError as exc:
            outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
            break
        store.save_verdicts(verdicts, provenance)
        outcome.classified += len(verdicts)
        if on_batch:
            on_batch(start // BATCH_SIZE + 1, total)
    return outcome


async def reclassify_stale(
    store: Store,
    *,
    provenance: Provenance,
    runner: Runner | None = None,
    model: str = DEFAULT_MODEL,
    max_batches: int,
) -> ClassifyOutcome:
    """Recompute verdicts made under another model, prompt or minor pipeline version.

    Bounded by `max_batches`; a failed batch keeps the previous verdicts and is retried on a
    later run. A published item is never unpublished (see `Store.refresh_verdict`).
    """
    outcome = ClassifyOutcome()
    stale = store.stale_classification(provenance, max_batches * BATCH_SIZE)
    for start in range(0, len(stale), BATCH_SIZE):
        batch = stale[start : start + BATCH_SIZE]
        try:
            verdicts = await classify_batch(batch, runner=runner, model=model)
        except LlmOutputError as exc:
            outcome.skipped_batches += 1
            outcome.skip_reasons.append(redact(str(exc))[:200])
            continue
        except LlmError as exc:
            outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
            break
        for verdict in verdicts:
            store.refresh_verdict(verdict, provenance)
        outcome.classified += len(verdicts)
    return outcome
