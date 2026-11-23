"""The structure of a paper: text lines with their place on the page, sections, figure captions.

Positions are normalised like the highlights are: [x, y, w, h], each in 0..1 of the page, with the
origin at the top left, so they do not depend on the zoom. Everything here is plain data taken from
the PDF: it is stored and shown, never executed or obeyed.
"""

from dataclasses import dataclass
from pathlib import Path
from statistics import median

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTTextContainer, LTTextLine
from pdfminer.pdftypes import PDFException
from pdfminer.psexceptions import PSException

from veille_reader.paper import MAX_PAGES, PaperError

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


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def extract_pages_structure(pdf_path: Path) -> list[PageStructure]:
    """The text lines of each page (the first MAX_PAGES), in reading order, with their place."""
    try:
        pages = []
        for layout in extract_pages(pdf_path, maxpages=MAX_PAGES):
            width, height = layout.width, layout.height
            blocks: list[Block] = []
            for element in layout:
                if not isinstance(element, LTTextContainer):
                    continue
                for line in element:
                    if not isinstance(line, LTTextLine):
                        continue
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
    except (PDFException, PSException, OSError, ValueError, KeyError, TypeError, RecursionError):
        raise PaperError("cannot read the PDF structure") from None
