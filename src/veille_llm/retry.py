"""Bounded retry with exponential backoff for flaky remote calls."""

from __future__ import annotations

import random
import time
import urllib.error
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

_TRANSIENT_CODES = {429, 500, 502, 503, 504}


def is_transient(exc: Exception) -> bool:
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in _TRANSIENT_CODES
    return isinstance(exc, (urllib.error.URLError, TimeoutError))


def retry_call(
    fn: Callable[[], T],
    *,
    attempts: int = 3,
    base_delay: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
    jitter: Callable[[], float] = random.random,
) -> T:
    """Call `fn`, retrying transient errors up to `attempts` calls in total."""
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            if attempt == attempts - 1 or not is_transient(exc):
                raise
            sleep(base_delay * 2**attempt * (0.5 + jitter()))
    raise AssertionError("unreachable")  # pragma: no cover
