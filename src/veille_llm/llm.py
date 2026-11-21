"""LLM access through the Claude Agent SDK on the user's subscription.

Rules: no API key (it would bill per token), no tools, one turn, validated JSON output.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping


class LlmError(Exception):
    """Any failure of an LLM call."""


class LlmAuthError(LlmError):
    """Token missing, invalid or revoked."""


class LlmLimitError(LlmError):
    """Subscription limit reached. Never retry: stop and keep what is already saved."""


_TOKEN = re.compile(r"sk-ant-[A-Za-z0-9_-]+")
_AUTH_MARKERS = ("401", "invalid bearer token", "authentication")
_LIMIT_MARKERS = ("usage limit", "rate limit", "limit reached", "429")
_RETRYABLE_MARKERS = ("500", "502", "503", "504", "overloaded")


def assert_subscription_auth(env: Mapping[str, str] = os.environ) -> None:
    """Refuse to run when an API key is set: that would bill per token, not use the plan."""
    if env.get("ANTHROPIC_API_KEY"):
        raise LlmError("ANTHROPIC_API_KEY is set: unset it, calls must use the subscription")


def classify_error(message: str) -> type[LlmError]:
    lowered = message.lower()
    if any(marker in lowered for marker in _AUTH_MARKERS):
        return LlmAuthError
    if any(marker in lowered for marker in _LIMIT_MARKERS):
        return LlmLimitError
    return LlmError


def is_retryable(exc: Exception) -> bool:
    if isinstance(exc, (LlmLimitError, LlmAuthError)):
        return False
    lowered = str(exc).lower()
    return any(marker in lowered for marker in _RETRYABLE_MARKERS)


def redact(text: str) -> str:
    return _TOKEN.sub("[REDACTED]", text)
