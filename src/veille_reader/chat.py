"""One chat turn: store the user message, stream the runner's events, store the answer."""

import json
import sqlite3
import time
from collections.abc import AsyncIterator

import anyio

from veille_llm.llm import redact
from veille_reader import events
from veille_reader.compaction import Summarizer, compact, current_history, needs_compaction
from veille_reader.events import AgentRunner, RunRequest
from veille_reader.limits import AgentLimits
from veille_reader.storage import ReaderStore


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


class _Answer:
    """Folds events into the assistant message that is stored at the end of the turn."""

    def __init__(self) -> None:
        self.blocks: list[dict] = []
        self.answer = ""
        self.duration_ms: int | None = None
        self.error: dict | None = None
        self.usage: dict | None = None
        self.tool_log: list[dict] = []
        self._tool_started: dict[str, tuple[str, float]] = {}
        self.started = time.monotonic()

    def apply(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "thinking_delta":
            if self.blocks and self.blocks[-1]["type"] == "thinking":
                self.blocks[-1]["text"] += event["text"]
            else:
                self.blocks.append({"type": "thinking", "text": event["text"]})
        elif kind == "tool_use":
            self._tool_started[event["id"]] = (event["name"], time.monotonic())
            self.blocks.append(
                {
                    "type": "tool",
                    "id": event["id"],
                    "name": event["name"],
                    "input": event["input"],
                    "summary": None,
                    "is_error": False,
                }
            )
        elif kind == "tool_result":
            name, began = self._tool_started.pop(event["id"], ("unknown", time.monotonic()))
            self.tool_log.append(
                {
                    "name": name,
                    "is_error": bool(event["is_error"]),
                    "duration_ms": int((time.monotonic() - began) * 1000),
                }
            )
            for block in self.blocks:
                if block["type"] == "tool" and block["id"] == event["id"]:
                    block["summary"] = event["summary"]
                    block["is_error"] = event["is_error"]
        elif kind == "text_delta":
            self.answer += event["text"]
        elif kind == "done":
            self.duration_ms = event["duration_ms"]
            self.usage = event.get("usage")
        elif kind == "error":
            self.error = {"kind": event["kind"], "message": event["message"]}

    def content(self, stopped: bool) -> dict:
        duration = self.duration_ms
        if duration is None:
            duration = int((time.monotonic() - self.started) * 1000)
        content = {
            "blocks": self.blocks,
            "answer": self.answer,
            "duration_ms": duration,
            "stopped": stopped,
        }
        if self.usage:
            content["usage"] = self.usage
        if self.error:
            content["error"] = self.error
        return content


def session_cost(messages: list[dict]) -> float:
    """What the answers of a conversation cost so far, as reported by the SDK."""
    total = 0.0
    for m in messages:
        if m["role"] == "assistant":
            total += float((m["content"].get("usage") or {}).get("cost_usd") or 0.0)
    return total


def session_refusal(
    store: ReaderStore, cid: int, messages: list[dict], limits: AgentLimits, raise_limit: bool
) -> str | None:
    """A message when the conversation is over its budget, else None (raisable once)."""
    spent = session_cost(messages)
    raised = store.limit_raised(cid)
    cap = limits.max_session_usd * (2 if raised else 1)
    if spent < cap:
        return None
    if raise_limit and not raised:
        store.mark_limit_raised(cid)
        if spent < limits.max_session_usd * 2:
            return None
        raised = True
    if raised:
        return (
            "This conversation already used its raised limit. Start a new conversation "
            "to keep going."
        )
    return (
        "This conversation reached its budget. Start a new conversation, or send your "
        "message again with the limit raised (this can be done once per conversation)."
    )


def _refusal_runner(message: str) -> AgentRunner:
    async def runner(request: RunRequest) -> AsyncIterator[dict]:
        yield events.error("limit", message)

    return runner


async def stream_turn(
    store: ReaderStore,
    runner: AgentRunner,
    item: dict,
    cid: int,
    kind: str | None,
    content: dict | None,
    *,
    tools: object = None,
    notes: list[str] | None = None,
    agent_limits: AgentLimits | None = None,
    tool_limits: object = None,
    model: str = "",
    raise_limit: bool = False,
    summarizer: Summarizer | None = None,
) -> AsyncIterator[str]:
    """Stream one turn. With `kind` None the last user message is run again (regenerate)."""
    if kind is not None and content is not None:
        store.add_message(cid, "user", kind, content)
    messages = store.messages(cid)
    limits = agent_limits or AgentLimits()
    refusal = session_refusal(store, cid, messages, limits, raise_limit)
    if refusal is not None:
        runner = _refusal_runner(refusal)
    summary, turns = current_history(messages)
    if (
        summarizer is not None
        and needs_compaction(turns)
        and await compact(store, cid, messages, summarizer)
    ):
        messages = store.messages(cid)
        summary, turns = current_history(messages)
    last = turns[-1]
    request = RunRequest(
        item=item,
        question=last["text"],
        history=turns[:-1],
        summary=summary,
        quote=last.get("quote"),
        paper_tools=tools,
        notes=list(notes or []),
        tool_limits=tool_limits,
        agent_limits=limits,
    )
    answer = _Answer()
    stopped = True
    events_stream = runner(request)
    try:
        try:
            async for event in events_stream:
                answer.apply(event)
                yield sse(event)
                if event.get("type") in ("done", "error"):
                    break
        except Exception as exc:  # noqa: BLE001 - reported to the user as a stream event
            failure = events.error("failed", redact(f"{type(exc).__name__}: {exc}"))
            answer.apply(failure)
            stopped = False
            yield sse(failure)
        else:
            stopped = False
    finally:
        # Save first, with no await before it: a cancelled request (Stop) is cancelled again at
        # every later await, so the answer must already be stored by then.
        final = answer.content(stopped)
        try:
            store.add_message(cid, "assistant", "assistant", final)
            usage = answer.usage or {}
            store.add_trace(
                cid,
                duration_ms=int(final["duration_ms"]),
                tools=answer.tool_log,
                input_tokens=int(usage.get("input_tokens") or 0),
                output_tokens=int(usage.get("output_tokens") or 0),
                cost_usd=float(usage.get("cost_usd") or 0.0),
                model=model,
                stopped=stopped,
                error_kind=(answer.error or {}).get("kind", ""),
            )
        except sqlite3.IntegrityError:
            pass  # the conversation was deleted while the answer was being produced
        aclose = getattr(events_stream, "aclose", None)
        if aclose is not None:
            with anyio.move_on_after(5, shield=True):
                try:
                    await aclose()
                except Exception:  # noqa: BLE001, S110 - closing a finished generator is best effort
                    pass
