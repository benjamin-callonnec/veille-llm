import pytest

from veille_reader import structure
from veille_reader.paper import PaperError
from veille_reader.structure import extract_pages_structure, extract_structure

from .pdf_factory import make_pdf


def write(tmp_path, pages, outline=None, sizes=None, name="p.pdf"):
    path = tmp_path / name
    path.write_bytes(make_pdf(pages, outline, sizes))
    return path


def test_blocks_have_normalised_top_left_rects(tmp_path):
    (page,) = extract_pages_structure(write(tmp_path, ["Hello world"]))
    assert (page.width, page.height) == (612, 792)
    (block,) = page.blocks
    assert block.text == "Hello world"
    x, y, w, h = block.rect
    assert x == pytest.approx(72 / 612, abs=0.02)
    assert 0.05 <= y <= 0.12  # the first line sits near the top, not near the bottom
    assert all(0 <= v <= 1 for v in block.rect)
    assert w > 0 and h > 0


def test_font_size_is_read(tmp_path):
    pdf = write(tmp_path, ["Big title\nSome body text"], sizes={"Big title": 18})
    blocks = {b.text: b for b in extract_pages_structure(pdf)[0].blocks}
    assert blocks["Big title"].size == pytest.approx(18, abs=0.5)
    assert blocks["Some body text"].size == pytest.approx(12, abs=0.5)


def test_an_empty_page_gives_no_blocks(tmp_path):
    (page,) = extract_pages_structure(write(tmp_path, [""]))
    assert page.blocks == []


def test_an_unreadable_pdf_raises_paper_error(tmp_path):
    path = tmp_path / "bad.pdf"
    path.write_bytes(b"this is not a pdf")
    with pytest.raises(PaperError):
        extract_pages_structure(path)


def test_only_the_first_pages_are_read(tmp_path, monkeypatch):
    monkeypatch.setattr(structure, "MAX_PAGES", 2)
    assert len(extract_pages_structure(write(tmp_path, ["a one", "a two", "a three"]))) == 2


def test_sections_from_the_pdf_outline_get_a_box(tmp_path):
    pdf = write(
        tmp_path,
        ["Introduction\nBody text one", "Method\nBody text two"],
        outline=[("Introduction", 1), ("Method", 2), ("Absent title", 2)],
    )
    sections = extract_structure(pdf).sections
    assert [(s.title, s.page) for s in sections] == [
        ("Introduction", 1),
        ("Method", 2),
        ("Absent title", 2),
    ]
    assert sections[0].rect is not None and sections[1].rect is not None
    assert sections[2].rect is None


BODY = "\n".join(f"Some ordinary body text, line {n}" for n in range(6))


def test_sections_without_outline_come_from_font_size_and_numbering(tmp_path):
    page = f"1 Introduction\n{BODY}\n3.1 Setup\nA body sentence that ends with a period."
    pdf = write(tmp_path, [page], sizes={"1 Introduction": 16, "3.1 Setup": 14})
    sections = extract_structure(pdf).sections
    assert [(s.title, s.level) for s in sections] == [("1 Introduction", 1), ("3.1 Setup", 2)]
    assert all(s.page == 1 and s.rect is not None for s in sections)


def test_figure_and_table_captions(tmp_path):
    page = (
        f"{BODY}\nFigure 2: Overview of the model\nTable 1. Results\n"
        "Figure 2 shows that the model works"
    )
    captions = extract_structure(write(tmp_path, [page])).captions
    assert [(c.kind, c.number, c.text, c.page) for c in captions] == [
        ("figure", 2, "Figure 2: Overview of the model", 1),
        ("table", 1, "Table 1. Results", 1),
    ]
    assert all(len(c.rect) == 4 for c in captions)


def test_a_scanned_pdf_gives_an_empty_structure(tmp_path):
    result = extract_structure(write(tmp_path, [""]))
    assert result.sections == []
    assert result.captions == []
    assert result.pages[0].blocks == []
