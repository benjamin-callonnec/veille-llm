"""The structure of a paper: text lines with their place on the page, sections, figure captions.

Positions are normalised like the highlights are: [x, y, w, h], each in 0..1 of the page, with the
origin at the top left, so they do not depend on the zoom. Everything here is plain data taken from
the PDF: it is stored and shown, never executed or obeyed.
"""

import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTTextContainer, LTTextLine

from veille_reader.citations import normalise
from veille_reader.paper import MAX_PAGES, PaperError, extract_outline
from veille_reader.storage import ReaderStore

Rect = tuple[float, float, float, float]

# bump when the way the structure is worked out changes: stored structures are then recomputed
EXTRACTOR = "pdfminer-1"


@dataclass(frozen=True)
class Block:
    """One line of text: its text, where it is, and its font size in points."""

    text: str
    rect: Rect
    size: float


@dataclass(frozen=True)
class PageStructure:
    width: float
    height: float
    blocks: list[Block]


@dataclass(frozen=True)
class Heading:
    """A section: its title, its page, where its heading line is (None when not found)."""

    title: str
    page: int
    rect: Rect | None
    level: int


@dataclass(frozen=True)
class Caption:
    """The caption of a figure or a table (kind is "figure" or "table")."""

    kind: str
    number: str  # as the paper writes it: "2", or "3.1" in papers numbered by chapter
    text: str
    page: int
    rect: Rect


@dataclass(frozen=True)
class Structure:
    extractor: str
    pages: list[PageStructure]
    sections: list[Heading]
    captions: list[Caption]

    def to_dict(self) -> dict:
        """The JSON form (rects are lists), what is stored and what the API sends."""
        return {
            "extractor": self.extractor,
            "pages": [
                {
                    "width": p.width,
                    "height": p.height,
                    "blocks": [
                        {"text": b.text, "rect": list(b.rect), "size": b.size} for b in p.blocks
                    ],
                }
                for p in self.pages
            ],
            "sections": [
                {
                    "title": h.title,
                    "page": h.page,
                    "rect": list(h.rect) if h.rect else None,
                    "level": h.level,
                }
                for h in self.sections
            ],
            "captions": [
                {
                    "kind": c.kind,
                    "number": c.number,
                    "text": c.text,
                    "page": c.page,
                    "rect": list(c.rect),
                }
                for c in self.captions
            ],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Structure":
        def rect(r: list[float]) -> Rect:
            x, y, w, h = r
            return (x, y, w, h)

        return cls(
            extractor=d["extractor"],
            pages=[
                PageStructure(
                    p["width"],
                    p["height"],
                    [Block(b["text"], rect(b["rect"]), b["size"]) for b in p["blocks"]],
                )
                for p in d["pages"]
            ],
            sections=[
                Heading(h["title"], h["page"], rect(h["rect"]) if h["rect"] else None, h["level"])
                for h in d["sections"]
            ],
            captions=[
                Caption(c["kind"], c["number"], c["text"], c["page"], rect(c["rect"]))
                for c in d["captions"]
            ],
        )


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _lines(layout):  # noqa: ANN001, ANN202
    """The text lines of a page: pdfminer groups most into boxes and leaves some on their own."""
    for element in layout:
        if isinstance(element, LTTextLine):
            yield element
        elif isinstance(element, LTTextContainer):
            yield from (line for line in element if isinstance(line, LTTextLine))


def extract_pages_structure(pdf_path: Path) -> list[PageStructure]:
    """The text lines of each page (the first MAX_PAGES), in reading order, with their place."""
    try:
        pages = []
        for layout in extract_pages(pdf_path, maxpages=MAX_PAGES):
            width, height = layout.width, layout.height
            blocks: list[Block] = []
            for line in _lines(layout):
                text = line.get_text().strip()
                sizes = [c.size for c in line if isinstance(c, LTChar)]
                if not text or not sizes or width <= 0 or height <= 0:
                    continue
                x = _clamp((line.x0 - layout.x0) / width)
                y = _clamp(1 - (line.y1 - layout.y0) / height)
                w = _clamp((line.x1 - layout.x0) / width) - x
                h = _clamp(1 - (line.y0 - layout.y0) / height) - y
                blocks.append(Block(text, (x, y, w, h), float(median(sizes))))
            pages.append(PageStructure(float(width), float(height), blocks))
        return pages
    except Exception:  # noqa: BLE001 - pdfminer raises many kinds on odd PDFs: all mean unreadable
        raise PaperError("cannot read the PDF structure") from None


# shortcut: font size 1.15x the body or a numbered title; calibrate on real papers (plan, task 10)
_HEADING_RATIO = 1.15
_NUMBERED = re.compile(r"^(\d+(?:\.\d+){0,2})\.?\s+[A-Z]")
_CAPTION = re.compile(r"^(figure|fig\.?|table)\s*(\d+(?:\.\d+)?)(?:\s*:|\.(?!\d))", re.IGNORECASE)
MAX_HEADING_CHARS = 120
MAX_NUMBERED_CHARS = 80


def _body_size(pages: list[PageStructure]) -> float | None:
    """The font size most of the text is set in (weighted by the length of each line)."""
    weights: Counter[float] = Counter()
    for page in pages:
        for block in page.blocks:
            weights[round(block.size, 1)] += len(block.text)
    return weights.most_common(1)[0][0] if weights else None


def _heading_level(block: Block, body: float) -> int | None:
    text = block.text
    if len(text) > MAX_HEADING_CHARS or text.endswith("."):
        return None
    numbered = _NUMBERED.match(text)
    if numbered and block.size >= body and len(text) <= MAX_NUMBERED_CHARS:
        return numbered.group(1).count(".") + 1
    return 1 if block.size >= body * _HEADING_RATIO else None


def _outline_sections(pages: list[PageStructure], outline: list[tuple[str, int]]) -> list[Heading]:
    sections = []
    for title, number in outline:
        wanted = normalise(title)
        blocks = pages[number - 1].blocks if 1 <= number <= len(pages) else []
        rect = next((b.rect for b in blocks if wanted and wanted in normalise(b.text)), None)
        numbered = _NUMBERED.match(title)
        level = numbered.group(1).count(".") + 1 if numbered else 1
        sections.append(Heading(title, number, rect, level))
    return sections


def extract_structure(pdf_path: Path) -> Structure:
    """Text lines, sections (the PDF outline, else guessed from the type) and figure captions."""
    pages = extract_pages_structure(pdf_path)
    outline = extract_outline(pdf_path)
    body = _body_size(pages)
    sections = _outline_sections(pages, outline) if outline else []
    captions = []
    for number, page in enumerate(pages, start=1):
        for block in page.blocks:
            caption = _CAPTION.match(block.text)
            if caption:
                kind = "table" if caption.group(1).lower() == "table" else "figure"
                captions.append(Caption(kind, caption.group(2), block.text, number, block.rect))
            elif not outline and body is not None:
                level = _heading_level(block, body)
                if level is not None:
                    sections.append(Heading(block.text, number, block.rect, level))
    return Structure(EXTRACTOR, pages, sections, captions)


def load_structure(store: ReaderStore, item_id: str, pdf_path: Path) -> Structure | None:
    """The structure of a paper: stored, else extracted once and stored; None if unreadable."""
    cached = store.paper_structure(item_id, EXTRACTOR)
    if cached is not None:
        try:
            return Structure.from_dict(cached)
        except (KeyError, TypeError, ValueError):
            pass  # a stored copy that does not fit: extract again
    try:
        result = extract_structure(pdf_path)
    except PaperError:
        return None
    store.save_paper_structure(item_id, EXTRACTOR, result.to_dict())
    return result
