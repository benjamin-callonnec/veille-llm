"""Keep the context small: summarise the old turns of a long conversation.

The summary is stored as a `compaction` message (role `system`) that records which messages it
replaces. The prompt then holds that summary plus the turns that came after it. The tutor's notes
(session memory) are always in the prompt, so they survive any compaction.
"""

from collections.abc import Awaitable, Callable

from veille_reader.storage import ReaderStore

COMPACT_AT = 20_000  # characters of history before the old turns are summarised
KEEP_RECENT = 4  # the latest turns are always kept as they were

Summarizer = Callable[[list[dict], "str | None"], Awaitable[str]]
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
    return {"role": "user", "text": content.get("text", "")}


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
    return len(turns) > KEEP_RECENT + 1 and sum(_size(t) for t in turns) > COMPACT_AT


async def compact(
    store: ReaderStore, cid: int, messages: list[dict], summarize: Summarizer
) -> dict | None:
    """Summarise every turn but the recent ones; None, and nothing stored, if it cannot be done."""
    summary, _ = current_history(messages)
    latest = _latest(messages)
    upto = int(latest["content"].get("upto_seq", 0)) if latest else 0
    live = [(m["seq"], turn_of(m)) for m in messages if m["role"] in _ROLES and m["seq"] > upto]
    old = live[:-KEEP_RECENT]
    if not old:
        return None
    try:
        text = (await summarize([t for _, t in old], summary)).strip()
    except Exception:  # noqa: BLE001 - the turn simply goes on with the full history
        return None
    if not text:
        return None
    return store.add_message(
        cid,
        "system",
        "compaction",
        {"summary": text, "upto_seq": old[-1][0], "replaced": len(old)},
    )
