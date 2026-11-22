"""The chat stream: one small dict per event, sent as one SSE message each."""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

from veille_reader.limits import AgentLimits


def thinking_delta(text: str) -> dict:
    return {"type": "thinking_delta", "text": text}


def tool_use(id: str, name: str, input: dict) -> dict:
    return {"type": "tool_use", "id": id, "name": name, "input": input}


def tool_result(id: str, summary: str, is_error: bool) -> dict:
    return {"type": "tool_result", "id": id, "summary": summary, "is_error": is_error}


def text_delta(text: str) -> dict:
    return {"type": "text_delta", "text": text}


def done(duration_ms: int, usage: dict | None = None) -> dict:
    event = {"type": "done", "duration_ms": duration_ms}
    if usage:
        event["usage"] = usage
    return event


def error(kind: str, message: str, usage: dict | None = None) -> dict:
    event = {"type": "error", "kind": kind, "message": message}
    if usage:
        event["usage"] = usage  # an answer that fails or hits a limit still cost something
    return event


def citations(items: list[dict]) -> dict:
    """The tutor's citations, checked against the paper (sent just before `done`)."""
    return {"type": "citations", "items": items}


def compaction(replaced: int) -> dict:
    return {"type": "compaction", "replaced": replaced}


@dataclass
class RunRequest:
    item: dict
    question: str
    history: list[dict] = field(default_factory=list)
    quote: dict | None = None
    summary: str | None = None  # the summary of the turns that were compacted away
    # the tutor's tools for this paper (a PaperTools) and the limits of this answer; with no tools
    # the agent answers from the summary alone
    paper_tools: Any = None
    notes: list[str] = field(default_factory=list)
    tool_limits: Any = None
    agent_limits: AgentLimits | None = None


AgentRunner = Callable[[RunRequest], AsyncIterator[dict]]
