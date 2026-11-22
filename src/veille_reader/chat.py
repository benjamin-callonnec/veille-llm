"""One chat turn: store the user message, stream the runner's events, store the answer."""

import json
import sqlite3
import time
from collections.abc import AsyncIterator

import anyio

from veille_llm.llm import redact
from veille_reader import events
from veille_reader.events import AgentRunner, RunRequest
from veille_reader.storage import ReaderStore


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def history_of(messages: list[dict]) -> list[dict]:
    turns = []
    for m in messages:
        content = m["content"]
        if m["role"] == "assistant":
            turns.append({"role": "assistant", "text": content.get("answer", "")})
        elif m["kind"] == "ask_agent":
            turns.append(
                {
                    "role": "user",
                    "text": content.get("question", ""),
                    "quote": content.get("quote"),
                }
            )
        else:
            turns.append({"role": "user", "text": content.get("text", "")})
    return turns


class _Answer:
    """Folds events into the assistant message that is stored at the end of the turn."""

    def __init__(self) -> None:
        self.blocks: list[dict] = []
        self.answer = ""
        self.duration_ms: int | None = None
        self.error: dict | None = None
        self.started = time.monotonic()

    def apply(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "thinking_delta":
            if self.blocks and self.blocks[-1]["type"] == "thinking":
                self.blocks[-1]["text"] += event["text"]
            else:
                self.blocks.append({"type": "thinking", "text": event["text"]})
        elif kind == "tool_use":
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
            for block in self.blocks:
                if block["type"] == "tool" and block["id"] == event["id"]:
                    block["summary"] = event["summary"]
                    block["is_error"] = event["is_error"]
        elif kind == "text_delta":
            self.answer += event["text"]
        elif kind == "done":
            self.duration_ms = event["duration_ms"]
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
        if self.error:
            content["error"] = self.error
        return content


async def stream_turn(
    store: ReaderStore,
    runner: AgentRunner,
    item: dict,
    cid: int,
    kind: str | None,
    content: dict | None,
) -> AsyncIterator[str]:
    """Stream one turn. With `kind` None the last user message is run again (regenerate)."""
    if kind is not None and content is not None:
        store.add_message(cid, "user", kind, content)
    messages = store.messages(cid)
    turns = history_of(messages)
    last = turns[-1]
    request = RunRequest(
        item=item,
        question=last["text"],
        history=turns[:-1],
        quote=last.get("quote"),
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
        try:
            store.add_message(cid, "assistant", "assistant", answer.content(stopped))
        except sqlite3.IntegrityError:
            pass  # the conversation was deleted while the answer was being produced
        aclose = getattr(events_stream, "aclose", None)
        if aclose is not None:
            with anyio.move_on_after(5, shield=True):
                try:
                    await aclose()
                except Exception:  # noqa: BLE001, S110 - closing a finished generator is best effort
                    pass
