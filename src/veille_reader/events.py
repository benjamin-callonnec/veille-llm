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


def error(kind: str, message: str, usage: dict | None = None, raisable: bool = False) -> dict:
    event = {"type": "error", "kind": kind, "message": message}
    if raisable:
        event["raisable"] = True  # the conversation budget can be raised once, from the chat
    if usage:
        event["usage"] = usage  # an answer that fails or hits a limit still cost something
    return event


def citations(items: list[dict]) -> dict:
    """The tutor's citations, checked against the paper (sent just before `done`)."""
    return {"type": "citations", "items": items}


def suggestions(items: list[str]) -> dict:
    """Follow-up questions for the user, already validated (sent just before `done`)."""
    return {"type": "suggestions", "items": items}


def ask_user(id: str, question: str, options: list[str], timeout: float) -> dict:
    """The tutor waits for an answer; the stream is paused until `ask_resolved`."""
    return {
        "type": "ask_user",
        "id": id,
        "question": question,
        "options": options,
        "timeout_s": int(timeout),
    }


def ask_resolved(id: str, status: str, answer: str | None = None) -> dict:
    event = {"type": "ask_resolved", "id": id, "status": status}
    if answer is not None:
        event["answer"] = answer
    return event


def memory_note(action: str, text: str) -> dict:
    """The tutor saved or deleted a note of its session memory (shown as a quiet line)."""
    return {"type": "memory_note", "action": action, "text": text}


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
    # the images attached to the question being asked, as validated `veille_reader.images.Image`
    images: list[Any] = field(default_factory=list)
    # `ask_user`: an async function (question, options) -> the user's reply, None if none came
    ask: Any = None
    # the skills the tutor may load (`Skill`s) and the one the user invoked with /name, if any
    skills: list[Any] = field(default_factory=list)
    skill: Any = None


AgentRunner = Callable[[RunRequest], AsyncIterator[dict]]
