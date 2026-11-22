"""One chat turn: store the user message, stream the runner's events, store the answer."""

import json
import sqlite3
import time
from collections.abc import AsyncIterator

import anyio

from veille_llm.llm import redact
from veille_reader import events
from veille_reader.citations import parse_citations, verify_citations
from veille_reader.compaction import Summarizer, compact, current_history, needs_compaction
from veille_reader.events import AgentRunner, RunRequest
from veille_reader.images import IMAGE_ID, Image
from veille_reader.limits import AgentLimits
from veille_reader.storage import ReaderStore
from veille_reader.suggestions import SuggestionFilter


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
        self.citations: list[dict] = []
        self.suggestions: list[str] = []
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
            if event.get("usage"):
                self.usage = event["usage"]

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
        if self.citations:
            content["citations"] = self.citations
        if self.suggestions:
            content["suggestions"] = self.suggestions
        if self.usage:
            content["usage"] = self.usage
        if self.error:
            content["error"] = self.error
        return content


def session_refusal(
    store: ReaderStore, cid: int, limits: AgentLimits, raise_limit: bool
) -> str | None:
    """A message when the conversation is over its budget, else None (raisable once)."""
    spent = store.session_cost(cid)
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


def load_images(store: ReaderStore, item_id: str, messages: list[dict]) -> list[Image]:
    """The images of the last question (it is the only turn that sends the bytes again)."""
    last = next((m for m in reversed(messages) if m["role"] == "user"), None)
    found = []
    for ref in (last["content"].get("images") or []) if last else []:
        if not isinstance(ref, dict) or not IMAGE_ID.fullmatch(str(ref.get("id", ""))):
            continue
        stored = store.image(item_id, ref["id"])
        if stored is not None:
            found.append(Image(ref["id"], stored[1], stored[0], ref.get("name")))
    return found


def check_citations(tools: object, text: str) -> list[dict]:
    """Check the citations of an answer against the paper; nothing to check without the paper."""
    paper = getattr(tools, "paper", None)
    if paper is None or not text:
        return []
    try:
        return verify_citations(paper.pages, paper.outline, parse_citations(text))
    except Exception:  # noqa: BLE001 - a failed check must never break the answer
        return []


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
    answer = _Answer()
    stopped = True
    events_stream = None
    # Everything from here is inside the try: Stop pressed while the old turns are being summarised
    # must still leave a stopped answer, not an orphan question.
    try:
        limits = agent_limits or AgentLimits()
        refusal = session_refusal(store, cid, limits, raise_limit)
        if refusal is not None:
            runner = _refusal_runner(refusal)
        messages = store.messages(cid)
        summary, turns = current_history(messages)
        # a refused turn does not pay for a summary
        if (
            refusal is None
            and summarizer is not None
            and needs_compaction(turns)
            and (done := await compact(store, cid, messages, summarizer))
        ):
            messages = store.messages(cid)
            summary, turns = current_history(messages)
            yield sse(events.compaction(int(done["content"].get("replaced", 0))))
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
            images=load_images(store, str(item.get("id", "")), messages),
        )
        events_stream = runner(request)
        hider = SuggestionFilter()
        try:
            async for event in events_stream:
                if event.get("type") == "text_delta":
                    event = {**event, "text": hider.feed(event["text"])}
                    if not event["text"]:
                        continue
                if event.get("type") == "done":
                    rest, answer.suggestions = hider.finish()
                    if rest:
                        late = events.text_delta(rest)
                        answer.apply(late)
                        yield sse(late)
                    answer.citations = check_citations(tools, answer.answer)
                    if answer.citations:
                        yield sse(events.citations(answer.citations))
                    if answer.suggestions:
                        yield sse(events.suggestions(answer.suggestions))
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
        if not answer.citations:  # an answer cut short is checked too, quietly
            answer.citations = check_citations(tools, answer.answer)
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
        aclose = getattr(events_stream, "aclose", None) if events_stream is not None else None
        if aclose is not None:
            with anyio.move_on_after(5, shield=True):
                try:
                    await aclose()
                except Exception:  # noqa: BLE001, S110 - closing a finished generator is best effort
                    pass
