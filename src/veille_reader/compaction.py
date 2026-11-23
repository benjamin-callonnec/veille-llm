"""Keep the context small: summarise the old turns of a long conversation.

The summary is stored as a `compaction` message (role `system`) that records which messages it
replaces. The prompt then holds that summary plus the turns that came after it. The tutor's notes
(session memory) are always in the prompt, so they survive any compaction.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from veille_reader.storage import ReaderStore

log = logging.getLogger(__name__)

COMPACT_AT = 20_000  # characters of history before the old turns are summarised
KEEP_RECENT = 4  # exchanges (a question and its answer) kept as they were, the newest included
MIN_OLD_CHARS = 1_000  # not worth a summary below this much old text
SUMMARY_TIMEOUT = 60.0  # seconds

Summarizer = Callable[[list[dict], "str | None"], Awaitable[str]]
IMAGE_NOTE = "[image attached]"
_ROLES = ("user", "assistant")


def turn_of(message: dict) -> dict:
    content = message["content"]
    if message["role"] == "assistant":
        return {"role": "assistant", "text": content.get("answer", "")}
    if message["kind"] == "ask_agent":
        return {
            "role": "user",
            "text": content.get("question", ""),
            "quote": content.get("quote"),
        }
    text = content.get("text", "")
    # the bytes are sent for the question being asked only; later turns and summaries get a note
    notes = " ".join([IMAGE_NOTE] * len(content.get("images") or []))
    return {"role": "user", "text": f"{text} {notes}".strip()}


def _latest(messages: list[dict]) -> dict | None:
    found = [m for m in messages if m["kind"] == "compaction"]
    return max(found, key=lambda m: m["seq"]) if found else None


def current_history(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """The summary of the old turns (if any) and the turns the prompt still carries."""
    latest = _latest(messages)
    upto = int(latest["content"].get("upto_seq", 0)) if latest else 0
    turns = [turn_of(m) for m in messages if m["role"] in _ROLES and m["seq"] > upto]
    summary = (latest["content"].get("summary") or None) if latest else None
    return summary, turns


def _size(turn: dict) -> int:
    return len(turn.get("text", "")) + len((turn.get("quote") or {}).get("text", ""))


def needs_compaction(turns: list[dict]) -> bool:
    exchanges = sum(1 for t in turns if t["role"] == "user")
    return exchanges > KEEP_RECENT and sum(_size(t) for t in turns) > COMPACT_AT


async def compact(
    store: ReaderStore, cid: int, messages: list[dict], summarize: Summarizer
) -> dict | None:
    """Summarise every turn but the recent ones; None, and nothing stored, if it cannot be done."""
    summary, _ = current_history(messages)
    latest = _latest(messages)
    upto = int(latest["content"].get("upto_seq", 0)) if latest else 0
    live = [(m["seq"], turn_of(m)) for m in messages if m["role"] in _ROLES and m["seq"] > upto]
    questions = [i for i, (_, turn) in enumerate(live) if turn["role"] == "user"]
    if len(questions) <= KEEP_RECENT:
        return None
    # cut just before the oldest question that is kept: an exchange is never split in two
    old = live[: questions[-KEEP_RECENT]]
    if not old or sum(_size(turn) for _, turn in old) < MIN_OLD_CHARS:
        return None
    try:
        text = (
            await asyncio.wait_for(summarize([t for _, t in old], summary), SUMMARY_TIMEOUT)
        ).strip()
    except Exception as exc:  # noqa: BLE001 - the turn simply goes on with the full history
        log.warning("compaction skipped: the summary failed (%s)", type(exc).__name__)
        return None
    if not text:
        return None
    return store.add_message(
        cid,
        "system",
        "compaction",
        {"summary": text, "upto_seq": old[-1][0], "replaced": len(old)},
    )
