"""LLM classification in small batches, each batch saved as soon as it is done."""

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
from veille_llm.models import Item, Verdict
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


async def classify_batch(
    items: list[Item], *, runner: Runner | None = None, model: str = DEFAULT_MODEL
) -> list[Verdict]:
    data = [
        {
            "id": i.id,
            "title": i.title,
            "summary": i.summary[:SUMMARY_MAX],
            "source": i.source,
            "kind": i.kind,
        }
        for i in items
    ]
    result = await complete_json(
        INSTRUCTIONS, CLASSIFY_SCHEMA, data=data, model=model, runner=runner
    )
    known = {i.id for i in items}
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
                type=entry["type"],
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
) -> ClassifyOutcome:
    outcome = ClassifyOutcome()
    pending = store.pending_classification()
    total = -(-len(pending) // BATCH_SIZE)
    if max_batches is not None:
        total = min(total, max_batches)
    for start in range(0, len(pending), BATCH_SIZE):
        if max_batches is not None and start // BATCH_SIZE >= max_batches:
            outcome.capped = True
            break
        batch = pending[start : start + BATCH_SIZE]
        try:
            verdicts = await classify_batch(batch, runner=runner, model=model)
        except LlmOutputError as exc:
            outcome.skipped_batches += 1
            outcome.skip_reasons.append(redact(str(exc))[:200])
            if on_batch:
                on_batch(start // BATCH_SIZE + 1, total)
            continue
        except LlmError as exc:
            outcome.stopped = redact(f"{type(exc).__name__}: {exc}")
            break
        store.save_verdicts(verdicts)
        outcome.classified += len(verdicts)
        if on_batch:
            on_batch(start // BATCH_SIZE + 1, total)
    return outcome
