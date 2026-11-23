"""The text of a cached PDF, for the tutor's tools: extracted once, cached in the database."""

import hashlib
import json
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from veille_reader.citations import normalise
from veille_reader.storage import ReaderStore

MAX_PAGES = 400


class PaperError(Exception):
    """The PDF cannot be read."""


def extract_pages(pdf_path: Path) -> list[str]:
    """Text of each page (empty for a page with none); only the first MAX_PAGES are read."""
    try:
        reader = PdfReader(pdf_path)
        pages = []
        for page in reader.pages[:MAX_PAGES]:
            try:
                pages.append((page.extract_text() or "").strip())
            except (PyPdfError, ValueError, KeyError, TypeError):
                pages.append("")
        return pages
    except (OSError, PyPdfError, ValueError, KeyError, TypeError) as exc:
        raise PaperError(f"cannot read the PDF: {type(exc).__name__}") from None


def extract_outline(pdf_path: Path) -> list[tuple[str, int]]:
    """The PDF's table of contents as (title, 1-based page), flattened; empty when it has none."""
    try:
        reader = PdfReader(pdf_path)
        entries: list[tuple[str, int]] = []

        def walk(items: list) -> None:
            for item in items:
                if isinstance(item, list):
                    walk(item)
                    continue
                try:
                    page = reader.get_destination_page_number(item) + 1
                except (PyPdfError, ValueError, KeyError, TypeError, AttributeError):
                    continue
                title = str(getattr(item, "title", "")).strip()
                if title and 1 <= page <= MAX_PAGES:
                    entries.append((title, page))

        walk(reader.outline)
        return entries
    except (OSError, PyPdfError, ValueError, KeyError, TypeError, RecursionError):
        return []


@dataclass(frozen=True)
class PaperText:
    pages: list[str]
    outline: list[tuple[str, int]]

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @cached_property
    def flat_pages(self) -> list[str]:
        """The normalised text of each page, worked out once (citations are checked against it)."""
        return [normalise(p) for p in self.pages]

    @cached_property
    def digest(self) -> str:
        """A fingerprint of the text: what a cache of anything derived from it is keyed by."""
        raw = json.dumps([self.pages, self.outline], ensure_ascii=False)
        return hashlib.sha256(raw.encode()).hexdigest()

    @property
    def has_text(self) -> bool:
        return any(p.strip() for p in self.pages)


def load_paper(store: ReaderStore, item_id: str, pdf_path: Path) -> PaperText:
    cached = store.paper_text(item_id)
    if cached is not None:
        return PaperText(pages=cached["pages"], outline=[(t, p) for t, p in cached["outline"]])
    pages = extract_pages(pdf_path)
    outline = extract_outline(pdf_path)
    store.save_paper_text(item_id, pages, outline)
    return PaperText(pages=pages, outline=outline)
