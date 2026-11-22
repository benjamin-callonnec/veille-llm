"""The chat stream: one small dict per event, sent as one SSE message each."""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field


def thinking_delta(text: str) -> dict:
    return {"type": "thinking_delta", "text": text}


def tool_use(id: str, name: str, input: dict) -> dict:
    return {"type": "tool_use", "id": id, "name": name, "input": input}


def tool_result(id: str, summary: str, is_error: bool) -> dict:
    return {"type": "tool_result", "id": id, "summary": summary, "is_error": is_error}


def text_delta(text: str) -> dict:
    return {"type": "text_delta", "text": text}


def done(duration_ms: int) -> dict:
    return {"type": "done", "duration_ms": duration_ms}


def error(kind: str, message: str) -> dict:
    return {"type": "error", "kind": kind, "message": message}


@dataclass
class RunRequest:
    item: dict
    question: str
    history: list[dict] = field(default_factory=list)
    quote: dict | None = None


AgentRunner = Callable[[RunRequest], AsyncIterator[dict]]
