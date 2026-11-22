"""Citations written by the tutor, and whether the paper really says what they claim.

The tutor cites as `[p.4 "short exact quote"]` (or `[p.4]` when it cannot quote). After each answer
every citation is checked against the text of the paper: the page exists, the quote is on that
page (ignoring spacing, case, hyphens, quotes and ligatures), otherwise on another page, otherwise
nowhere.
"""

import re
import unicodedata
from dataclasses import dataclass

# a quote needs this many letters and digits to prove anything
MIN_QUOTE_CHARS = 8
MAX_QUOTE_CHARS = 300

_CITE = re.compile(r'\[p\.(\d+)(?:\s*[:,]?\s*["“«]([^"”»\]]*)["”»])?\s*\]')


@dataclass(frozen=True)
class Citation:
    page: int
    quote: str | None
    start: int
    end: int


def parse_citations(text: str) -> list[Citation]:
    found = []
    for match in _CITE.finditer(text):
        quote = (match.group(2) or "").strip()
        found.append(
            Citation(
                page=int(match.group(1)),
                quote=quote if 0 < len(quote) <= MAX_QUOTE_CHARS else None,
                start=match.start(),
                end=match.end(),
            )
        )
    return found


def normalise(text: str) -> str:
    """Only the letters and digits, in lower case, so layout and punctuation never matter."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return "".join(ch for ch in folded if ch.isalnum())


def _section(outline: list[tuple[str, int]], page: int) -> str | None:
    title = None
    for name, start in sorted(outline, key=lambda entry: entry[1]):
        if start <= page:
            title = name
    return title


def verify_citations(
    pages: list[str], outline: list[tuple[str, int]], citations: list[Citation]
) -> list[dict]:
    """One verdict per distinct citation (verified, wrong_page, unverified, page_only, ...)."""
    flat = [normalise(p) for p in pages]
    seen: set[tuple[int, str | None]] = set()
    verdicts: list[dict] = []
    for citation in citations:
        needle = normalise(citation.quote) if citation.quote else ""
        key = (citation.page, needle or None)
        if key in seen:
            continue
        seen.add(key)
        verdict: dict = {"page": citation.page, "quote": citation.quote}
        target = citation.page
        if not 1 <= citation.page <= len(pages):
            verdict["status"] = "invalid_page"
        elif len(needle) < MIN_QUOTE_CHARS:
            verdict["status"] = "page_only"
            verdict["quote"] = None
        elif needle in flat[citation.page - 1]:
            verdict["status"] = "verified"
        else:
            elsewhere = next((i + 1 for i, page in enumerate(flat) if needle in page), None)
            if elsewhere is None:
                verdict["status"] = "unverified"
            else:
                verdict["status"] = "wrong_page"
                verdict["found_page"] = elsewhere
                target = elsewhere
        verdict["section"] = (
            _section(outline, target) if verdict["status"] != "invalid_page" else None
        )
        verdicts.append(verdict)
    return verdicts
