"""Citations written by the tutor, and whether the paper really says what they claim.

The tutor cites as `[p.4 "short exact quote"]` (or `[p.4]` when it cannot quote). After each answer
every citation is checked against the text of the paper: the page exists, the quote is on that
page (ignoring spacing, case, hyphens, quotes and ligatures), otherwise on another page, otherwise
nowhere.
"""

import html
import re
import unicodedata
from dataclasses import dataclass

# a quote needs this many letters and digits to prove anything
MIN_QUOTE_CHARS = 8
MAX_QUOTE_CHARS = 300

_CITE = re.compile(
    r'\[p\.(\d+)(?:\s*[:,]?\s*(?:["“«]([^"”»\]]*)["”»]|((?i:figure|fig\.?|table))\s*(\d{1,3}(?:\.\d{1,3})?)))?\s*\]',
)


@dataclass(frozen=True)
class Citation:
    page: int
    quote: str | None
    start: int
    end: int
    label: str | None = None  # "figure 2" or "table 1": a place named instead of quoted


def _label(kind: str | None, number: str | None) -> str | None:
    if not kind or not number:
        return None
    return f"{'table' if kind.lower() == 'table' else 'figure'} {number}"


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
                label=_label(match.group(3), match.group(4)),
            )
        )
    return found


def normalise(text: str) -> str:
    """Only the letters and digits, in lower case, so layout and punctuation never matter."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return "".join(ch for ch in folded if ch.isalnum())


def _offsets(text: str) -> tuple[str, list[int]]:
    """The normalised text and, for each of its characters, where it came from in the raw text."""
    chars: list[str] = []
    where: list[int] = []
    for i, ch in enumerate(text):
        for c in normalise(ch):
            chars.append(c)
            where.append(i)
    return "".join(chars), where


def _section_at(
    pages: list[str], outline: list[tuple[str, int]], page: int, needle: str
) -> str | None:
    """The section a quote is in. Several sections can start on one page (a small paper, a dense
    page): the heading line just before the quote decides; text above the first heading of the
    page belongs to the section that was open at the end of the page before."""
    starting = [title for title, start in outline if start == page]
    if not starting:
        return _section(outline, page)
    before = _section(outline, page - 1)
    text = pages[page - 1]
    normalised, where = _offsets(text)
    at = normalised.find(needle)
    if at < 0:
        return before
    quote_at = where[at]
    best: tuple[int, str] | None = None
    seen_heading = False
    offset = 0
    for line in text.split("\n"):
        flat = normalise(line)
        for title in starting:
            wanted = normalise(title)
            # a heading line is the title, maybe with a section number in front
            if wanted and flat.endswith(wanted) and len(flat) - len(wanted) <= 4:
                seen_heading = True
                if offset <= quote_at and (best is None or offset >= best[0]):
                    best = (offset, title)
        offset += len(line) + 1
    if best:
        return best[1]
    # above the first heading of the page: the section left open by the page before; and when no
    # heading can be found in the text at all, we do not know
    return before if seen_heading else None


def _section(outline: list[tuple[str, int]], page: int) -> str | None:
    title = None
    for name, start in sorted(outline, key=lambda entry: entry[1]):
        if start <= page:
            title = name
    return title


def _section_of(
    pages: list[str], outline: list[tuple[str, int]], status: str, page: int, needle: str
) -> str | None:
    if status == "invalid_page":
        return None
    if status in ("verified", "wrong_page"):
        return _section_at(pages, outline, page, needle)
    # no usable quote: a bare page names a section only if the whole page lies inside one
    return None if any(start == page for _, start in outline) else _section(outline, page)


def verify_citations(
    pages: list[str],
    outline: list[tuple[str, int]],
    citations: list[Citation],
    flat: list[str] | None = None,
) -> list[dict]:
    """One verdict per distinct citation (verified, wrong_page, unverified, page_only, ...).

    `flat` is the normalised text of each page when the caller already has it (PaperText caches it).
    """
    if not citations:
        return []
    if flat is None:
        flat = [normalise(p) for p in pages]
    seen: set[tuple[int, str | None, str | None]] = set()
    verdicts: list[dict] = []
    for citation in citations:
        # the model reads escaped text (&amp; &lt; &gt;): its quote may carry the entities
        quote = html.unescape(citation.quote) if citation.quote else None
        needle = normalise(quote) if quote else ""
        key = (citation.page, needle or None, citation.label)
        if key in seen:
            continue
        seen.add(key)
        verdict: dict = {"page": citation.page, "quote": quote}
        if citation.label:
            verdict["label"] = citation.label
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
        verdict["section"] = _section_of(pages, outline, verdict["status"], target, needle)
        verdicts.append(verdict)
    return verdicts
