"""Retry a rejected LLM batch in two halves, so one bad reply does not lose a whole batch."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from veille_llm.llm import LlmOutputError, redact

T = TypeVar("T")


def _record(outcome: Any, exc: Exception) -> None:
    outcome.skipped_batches += 1
    outcome.skip_reasons.append(redact(str(exc))[:200])


async def with_halves(
    batch: list[Any], attempt: Callable[[list[Any]], Awaitable[list[T]]], outcome: Any
) -> list[T]:
    """Try the whole batch; on a bad reply try each half once. Other LLM errors propagate.

    A half that fails again is counted as skipped (its items stay pending for a later run).
    """
    try:
        return await attempt(batch)
    except LlmOutputError as exc:
        if len(batch) == 1:
            _record(outcome, exc)
            return []
    results: list[T] = []
    middle = (len(batch) + 1) // 2
    for half in (batch[:middle], batch[middle:]):
        try:
            results += await attempt(half)
        except LlmOutputError as exc:
            _record(outcome, exc)
    return results
