"""The tutor's tools: read-only on the paper, results are escaped data, every call is limited."""

import asyncio
import html
import re
import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from veille_reader.paper import PaperText
from veille_reader.retrieval import Index, build_index

MAX_PAGES_PER_CALL = 6
MAX_CHARS = 12_000
MAX_HITS = 8
MAX_SECTION_CHARS = 120
MAX_SECTIONS_LISTED = 40
MAX_NOTE_CHARS = 500
KINDS = ("pages", "section", "references", "figure", "table", "highlights")


class ToolError(Exception):
    """A problem to tell the model about (shown to the user, never fatal)."""


class Memory(Protocol):
    def read(self) -> list[dict]: ...
    def write(self, text: str) -> dict: ...
    def delete(self, note_id: int) -> bool: ...


def _clean(text: str) -> str:
    return html.escape(text, quote=False)


def _data(label: str, text: str) -> str:
    """Anything that comes from the paper or the user goes in one escaped data block."""
    return f'<data source="{label}">\n{_clean(text)}\n</data>'


def _int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int | str):
        raise ToolError(f"{name} must be a whole number")
    try:
        return int(value)
    except ValueError:
        raise ToolError(f"{name} must be a whole number") from None


_INDEXES: OrderedDict[str, Index] = OrderedDict()
_INDEXES_LOCK = threading.Lock()
MAX_INDEXES = 8  # papers whose search index stays in memory


def _index_of(paper: PaperText) -> Index:
    """The search index of a paper, built once and reused by every turn (keyed by its text)."""
    key = paper.digest
    with _INDEXES_LOCK:
        if key in _INDEXES:
            _INDEXES.move_to_end(key)
            return _INDEXES[key]
    index = build_index(paper.pages, paper.outline)
    with _INDEXES_LOCK:
        _INDEXES[key] = index
        while len(_INDEXES) > MAX_INDEXES:
            _INDEXES.popitem(last=False)
    return index


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


class PaperTools:
    def __init__(self, paper: PaperText, highlights: list[dict], memory: Memory) -> None:
        self.paper = paper
        self.highlights = highlights
        self.memory = memory

    # --- load_artifact -------------------------------------------------------------------
    def load_artifact(
        self,
        kind: str,
        start: object = None,
        end: object = None,
        title: str | None = None,
        number: object = None,
    ) -> str:
        if kind == "highlights":
            return self._highlights()
        if kind not in KINDS:
            raise ToolError(f"Unknown kind '{_clean(str(kind))}'. Valid kinds: {', '.join(KINDS)}.")
        self._need_text()
        if kind == "pages":
            if start is None or end is None:
                raise ToolError("kind 'pages' needs start and end (page numbers, from 1)")
            return self._pages(_int(start, "start"), _int(end, "end"))
        if kind == "section":
            return self._section(title or "")
        if kind == "references":
            return self._references()
        if number is None:
            raise ToolError(f"kind '{kind}' needs number (the figure or table number)")
        label = "Figure" if kind == "figure" else "Table"
        return self._caption(label, _int(number, "number"))

    def _need_text(self) -> None:
        if not self.paper.has_text:
            raise ToolError(
                "This paper has no extractable text (probably a scanned PDF): only the user's "
                "highlights and notes are available."
            )

    def _pages(self, start: int, end: int) -> str:
        count = self.paper.page_count
        if start < 1 or start > count:
            raise ToolError(f"page {start} is out of range: pages are between 1 and {count}")
        if end < start:
            raise ToolError("end must not be smaller than start")
        last = min(end, count, start + MAX_PAGES_PER_CALL - 1)
        parts = [f"--- page {n} ---\n{self.paper.pages[n - 1]}" for n in range(start, last + 1)]
        text = "\n\n".join(parts)
        notes = []
        if last < min(end, count):
            notes.append(
                f"[{MAX_PAGES_PER_CALL} pages at most per call: ask for pages {last + 1} on]"
            )
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS]
            notes.append(f"[cut at {MAX_CHARS} characters]")
        return _data(f"pages {start}-{last}", "\n".join([text, *notes]))

    def _section(self, title: str) -> str:
        outline = self.paper.outline
        if not outline:
            raise ToolError("This paper has no outline (table of contents): use kind 'pages'.")
        wanted = title.strip().lower()
        for i, (name, page) in enumerate(outline):
            if wanted and wanted in name.lower():
                after = outline[i + 1][1] if i + 1 < len(outline) else self.paper.page_count + 1
                return self._pages(page, max(page, after - 1))
        names = "\n".join(n[:120] for n, _ in outline[:MAX_SECTIONS_LISTED])
        raise ToolError(
            f"No section matches '{_clean(title)[:80]}'. The sections of the paper:\n"
            + _data("sections", names)
        )

    def _references(self) -> str:
        heading = re.compile(r"^\s*(references|bibliography)\s*$", re.I | re.M)
        for number in range(self.paper.page_count, 0, -1):
            if heading.search(self.paper.pages[number - 1]):
                return self._pages(number, self.paper.page_count)
        raise ToolError("No References heading found: try search_paper or kind 'pages'.")

    def _caption(self, label: str, number: int) -> str:
        if label == "Figure":
            pattern = re.compile(rf"^\s*(?:figure|fig\.?)\s*{number}\b", re.I)
        else:
            pattern = re.compile(rf"^\s*table\s*{number}\b", re.I)
        for page_number, page in enumerate(self.paper.pages, start=1):
            lines = page.split("\n")
            for i, line in enumerate(lines):
                if pattern.match(line):
                    context = "\n".join(lines[i : i + 4])
                    return _data(
                        f"{label.lower()} {number}", f"--- page {page_number} ---\n{context}"
                    )
        raise ToolError(f"{label} {number} not found: try search_paper.")

    def _highlights(self) -> str:
        if not self.highlights:
            return "The user has no highlights yet."
        lines = [
            f"page {h['page']} ({h.get('color', '')}): {h['text']}" for h in self.highlights[:20]
        ]
        return _data("highlights", "\n".join(lines))

    # --- search_paper --------------------------------------------------------------------
    def search_paper(self, query: str) -> str:
        if not _norm(query):
            raise ToolError("query must not be empty")
        self._need_text()
        hits = _index_of(self.paper).search(query, limit=MAX_HITS)
        if not hits:
            return "No results for that query."
        lines = []
        for hit in hits:
            where = f"page {hit.page}"
            if hit.section:
                where += f" (section: {_norm(hit.section)[:MAX_SECTION_CHARS]})"
            lines.append(f"{where}: …{hit.snippet}…")
        header = f"{len(hits)} results" + (
            " (the first ones only)" if len(hits) == MAX_HITS else ""
        )
        return _data("search results", header + "\n" + "\n".join(lines))

    # --- session_memory ------------------------------------------------------------------
    def session_memory(self, action: str, text: str | None = None, id: object = None) -> str:  # noqa: A002
        if action == "read":
            notes = self.memory.read()
            if not notes:
                return "There are no notes yet."
            return _data("notes", "\n".join(f"[{n['id']}] {n['text']}" for n in notes))
        if action == "write":
            value = (text or "").strip()
            if not value:
                raise ToolError("text must not be empty")
            if len(value) > MAX_NOTE_CHARS:
                raise ToolError(f"a note is {MAX_NOTE_CHARS} characters at most")
            note = self.memory.write(value)
            return f"Saved note {note['id']}."
        if action == "delete":
            note_id = _int(id, "id")
            if not self.memory.delete(note_id):
                raise ToolError("There is no note with that id.")
            return f"Deleted note {note_id}."
        raise ToolError("action must be read, write or delete")


@dataclass(frozen=True)
class Limits:
    max_calls: int = 12
    max_per_tool: int = 6
    timeout_s: float = 15.0


class ToolBudget:
    """The tool limiter of one answer: calls per answer, calls per tool, time per call."""

    def __init__(self, limits: Limits = Limits()) -> None:  # noqa: B008
        self.limits = limits
        self.calls = 0
        self._per_tool: dict[str, int] = {}

    async def run(self, name: str, fn: Callable[[], str]) -> str:
        if self.calls >= self.limits.max_calls:
            raise ToolError(
                f"Tool limit reached: {self.limits.max_calls} tool calls at most per answer. "
                "Answer with what you already have."
            )
        if self._per_tool.get(name, 0) >= self.limits.max_per_tool:
            raise ToolError(
                f"Tool limit reached: {self.limits.max_per_tool} calls to {name} at most "
                "per answer."
            )
        self.calls += 1
        self._per_tool[name] = self._per_tool.get(name, 0) + 1
        try:
            return await asyncio.wait_for(asyncio.to_thread(fn), self.limits.timeout_s)
        except TimeoutError:
            raise ToolError(f"{name} timed out after {self.limits.timeout_s:g}s") from None
        except ToolError:
            raise
        except Exception:  # noqa: BLE001 - the model gets a plain message, not an internal detail
            raise ToolError(f"{name} failed") from None
