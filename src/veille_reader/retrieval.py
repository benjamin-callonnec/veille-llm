"""Local ranked passage search for the tutor: contextual BM25, no model, no dependency.

Each page is cut into passages; the title of the section a passage belongs to is indexed with it
(contextual retrieval) but never shown in the snippet. Everything returned is plain text taken
from the PDF: the caller escapes it.
"""

import math
import re
import unicodedata
from bisect import bisect_right
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache

K1 = 1.5
B = 0.75
PASSAGE_TARGET = 700
PASSAGE_MAX = 900
OVERLAP_MAX = 160
SNIPPET_CHARS = 220
MAX_PER_PAGE = 2
MAX_QUERY_CHARS = 300
MAX_QUERY_TERMS = 40
MAX_TOKEN_CHARS = 40

STOP_WORDS = frozenset(
    "a an and are as at be been but by can do does for from had has have how i if in into is it "
    "its of on or our so such than that the their then there these they this to was we were what "
    "when where which while who why will with you your".split()
)

_TOKEN = re.compile(r"[^\W_]+")
_PARAGRAPH = re.compile(r"\n\s*\n")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_SPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class Hit:
    page: int
    section: str | None
    snippet: str
    score: float


@lru_cache(maxsize=100_000)
def _term(token: str) -> str:
    """Fold diacritics, lower-case, drop a plural s/es: the form that is indexed and matched."""
    if not token.isascii():
        token = "".join(
            c for c in unicodedata.normalize("NFKD", token) if not unicodedata.combining(c)
        )
    token = token.casefold()[:MAX_TOKEN_CHARS]
    n = len(token)
    if n > 3 and token[-1] == "s" and token[-2:] not in ("ss", "us", "is"):
        if token.endswith(("sses", "xes", "ches", "shes")):
            return token[:-2]
        return token[:-1]
    return token


def _terms(text: str) -> list[str]:
    return [_term(t) for t in _TOKEN.findall(text)]


def _split(text: str) -> list[str]:
    """Pieces of at most PASSAGE_MAX characters, on paragraph then sentence then word bounds."""
    units: list[str] = []
    for paragraph in _PARAGRAPH.split(text):
        for sentence in _SENTENCE.split(_SPACES.sub(" ", paragraph).strip()):
            while len(sentence) > PASSAGE_MAX:
                cut = sentence.rfind(" ", 0, PASSAGE_MAX)
                if cut <= 0:
                    cut = PASSAGE_MAX  # one giant word: nothing better to do
                units.append(sentence[:cut].strip())
                sentence = sentence[cut:].strip()
            if sentence:
                units.append(sentence)
    return units


def _passages(page_text: str) -> list[str]:
    """Passages of about PASSAGE_TARGET characters; a short last sentence is repeated as overlap."""
    out: list[str] = []
    current: list[str] = []
    size = 0
    fresh = False  # does `current` hold something that is not only the overlap?

    def flush() -> None:
        nonlocal current, size, fresh
        out.append(" ".join(current))
        tail = current[-1]
        current, size = ([tail], len(tail)) if len(tail) <= OVERLAP_MAX else ([], 0)
        fresh = False

    for unit in _split(page_text):
        if fresh and size + len(unit) + 1 > PASSAGE_MAX:
            flush()
        current.append(unit)
        size += len(unit) + 1
        fresh = True
        if size >= PASSAGE_TARGET:
            flush()
    if fresh:
        out.append(" ".join(current))
    return out


class Index:
    def __init__(self) -> None:
        self.pages: list[int] = []
        self.sections: list[str | None] = []
        self.texts: list[str] = []
        self.flat: list[str] = []  # passage terms joined by spaces, for exact-phrase matching
        self.lengths: list[int] = []
        self.postings: dict[str, list[tuple[int, int]]] = {}
        self.avg_length = 1.0

    def _idf(self, term: str) -> float:
        n = len(self.postings[term])
        return math.log(1 + (len(self.texts) - n + 0.5) / (n + 0.5))

    def search(self, query: str, limit: int = 8) -> list[Hit]:
        raw = _terms(query[:MAX_QUERY_CHARS])[:MAX_QUERY_TERMS]
        wanted = list(dict.fromkeys(t for t in raw if t not in STOP_WORDS))
        wanted = [t for t in wanted if t in self.postings]
        if limit <= 0 or not wanted or not self.texts:
            return []
        scores: dict[int, float] = {}
        total_idf = 0.0
        for term in wanted:
            idf = self._idf(term)
            total_idf += idf
            for pid, tf in self.postings[term]:
                norm = K1 * (1 - B + B * self.lengths[pid] / self.avg_length)
                scores[pid] = scores.get(pid, 0.0) + idf * tf * (K1 + 1) / (tf + norm)
        if len(raw) > 1:
            phrase = f" {' '.join(raw)} "
            bonus = total_idf * (K1 + 1)
            for pid in scores:
                if phrase in self.flat[pid]:
                    scores[pid] += bonus
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], self.pages[kv[0]], kv[0]))
        weights = {t: self._idf(t) for t in wanted}
        hits: list[Hit] = []
        per_page: Counter[int] = Counter()
        for pid, score in ranked:
            page = self.pages[pid]
            if per_page[page] >= MAX_PER_PAGE:
                continue
            per_page[page] += 1
            hits.append(Hit(page, self.sections[pid], _snippet(self.texts[pid], weights), score))
            if len(hits) >= limit:
                break
        return hits


def _snippet(text: str, weights: dict[str, float]) -> str:
    if len(text) <= SNIPPET_CHARS:
        return text
    spots = [(m.start(), _term(m.group())) for m in _TOKEN.finditer(text)]
    spots = [(p, t) for p, t in spots if t in weights]
    start = 0
    best = -1.0
    for p, _ in spots:
        lo = max(0, p - 60)
        seen = {t for q, t in spots if lo <= q < lo + SNIPPET_CHARS}
        value = sum(weights[t] for t in seen)
        if value > best + 1e-9:
            best, start = value, lo
    end = start + SNIPPET_CHARS
    if start > 0 and not text[start - 1].isspace() and not text[start].isspace():
        gap = text.find(" ", start, end)
        start = gap + 1 if gap != -1 else start
    if end < len(text) and not text[end].isspace() and not text[end - 1].isspace():
        gap = text.rfind(" ", start, end)
        end = gap if gap > start else end
    return text[start:end].strip()


def build_index(pages: list[str], outline: list[tuple[str, int]]) -> Index:
    index = Index()
    ordered = sorted(outline, key=lambda entry: entry[1])
    starts = [page for _, page in ordered]
    counts: list[Counter[str]] = []
    total = 0
    for number, page_text in enumerate(pages, start=1):
        at = bisect_right(starts, number)
        section = ordered[at - 1][0] if at else None
        context = _terms(section) if section else []
        for text in _passages(page_text):
            terms = _terms(text)
            if not terms:
                continue
            counter = Counter(terms)
            counter.update(context)
            pid = len(index.texts)
            index.pages.append(number)
            index.sections.append(section)
            index.texts.append(text)
            index.flat.append(" " + " ".join(terms) + " ")
            length = len(terms) + len(context)
            index.lengths.append(length)
            total += length
            counts.append(counter)
            for term, tf in counter.items():
                index.postings.setdefault(term, []).append((pid, tf))
    index.avg_length = total / len(counts) if counts else 1.0
    return index
