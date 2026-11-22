"""Follow-up questions the tutor proposes at the end of an answer.

The tutor ends its answer with `<suggestions>["...", "..."]</suggestions>`. The block is hidden from
the visible answer while it streams, then checked like any model text before it reaches the user.
"""

import json
import re

OPEN = "<suggestions>"
CLOSE = "</suggestions>"
MAX_SUGGESTIONS = 3
MAX_LENGTH = 120

SUGGESTIONS_RULE = (
    " At the very end of every answer, after the answer itself, add one last line with up to "
    f"{MAX_SUGGESTIONS} short follow-up questions the user could ask next, as a JSON list of "
    f'strings inside {OPEN} and {CLOSE}, for example {OPEN}["Why does it work?"]{CLOSE}. Each is '
    f"plain text under {MAX_LENGTH} characters, without markdown or tags. When a question needs "
    "something from the user, write it as a [placeholder]. Add nothing after that line."
)

_MARKUP = re.compile(r"[<>`]|\]\(|https?:|www\.|[\x00-\x1f\x7f]", re.I)


def with_rule(system_prompt: str) -> str:
    return system_prompt + SUGGESTIONS_RULE


def parse_suggestions(raw: str) -> list[str]:
    """Keep the well-formed, plain, short questions (at most three); anything else is dropped."""
    try:
        items = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(items, list):
        return []
    found: list[str] = []
    for item in items:
        if not isinstance(item, str):
            continue
        text = " ".join(item.split())
        if not text or len(text) > MAX_LENGTH or _MARKUP.search(text) or text in found:
            continue
        found.append(text)
        if len(found) == MAX_SUGGESTIONS:
            break
    return found


class SuggestionFilter:
    """Hides the suggestions block from streamed text and collects what is inside it."""

    def __init__(self) -> None:
        self._held = ""  # a tail that could still turn out to be the start of the tag
        self._hidden = ""  # inside the block
        self._inside = False

    def feed(self, text: str) -> str:
        """The part of `text` that is safe to show now."""
        if self._inside:
            self._hidden += text
            return ""
        text = self._held + text
        self._held = ""
        at = text.find(OPEN)
        if at >= 0:
            self._inside = True
            self._hidden = text[at + len(OPEN) :]
            return text[:at]
        for n in range(min(len(OPEN) - 1, len(text)), 0, -1):
            if text.endswith(OPEN[:n]):
                self._held = text[-n:]
                return text[:-n]
        return text

    def finish(self) -> tuple[str, list[str]]:
        """What was still held back (not a tag after all) and the validated suggestions."""
        leftover, self._held = self._held, ""
        if not self._inside:
            return leftover, []
        raw = self._hidden.split(CLOSE)[0].strip()
        return leftover, parse_suggestions(raw)
