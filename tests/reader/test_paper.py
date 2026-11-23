import pytest

from veille_reader import paper
from veille_reader.paper import PaperError, extract_outline, extract_pages, load_paper
from veille_reader.storage import ReaderStore

from .pdf_factory import make_pdf

PAGES = [
    "Attention Is All You Need\nAbstract: the Transformer",
    "1 Introduction\nRecurrent models are slow",
    "2 Model\nMulti-head attention (see Figure 1)",
]


def write(tmp_path, pages=PAGES, outline=None, name="p.pdf"):
    path = tmp_path / name
    path.write_bytes(make_pdf(pages, outline))
    return path


def test_the_text_of_every_page_is_extracted(tmp_path):
    pages = extract_pages(write(tmp_path))
    assert len(pages) == 3
    assert "Transformer" in pages[0]
    assert "Recurrent models are slow" in pages[1]
    assert "Multi-head attention (see Figure 1)" in pages[2]


def test_a_pdf_without_text_gives_empty_pages(tmp_path):
    pages = extract_pages(write(tmp_path, pages=["", "", ""]))
    assert pages == ["", "", ""]


def test_a_corrupt_file_is_a_clean_error(tmp_path):
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(PaperError):
        extract_pages(bad)
    with pytest.raises(PaperError):
        extract_pages(tmp_path / "missing.pdf")


def test_only_the_first_pages_are_read_of_a_huge_document(tmp_path, monkeypatch):
    monkeypatch.setattr(paper, "MAX_PAGES", 2)
    assert len(extract_pages(write(tmp_path))) == 2


def test_the_outline_gives_titles_and_pages(tmp_path):
    path = write(tmp_path, outline=[("Introduction", 2), ("Model", 3)])
    assert extract_outline(path) == [("Introduction", 2), ("Model", 3)]


def test_a_pdf_without_an_outline_gives_an_empty_list(tmp_path):
    assert extract_outline(write(tmp_path)) == []


def test_the_text_is_cached_in_the_database(tmp_path, monkeypatch):
    path = write(tmp_path, outline=[("Intro", 2)])
    store = ReaderStore(tmp_path / "data")
    calls = []
    real = paper.extract_pages
    monkeypatch.setattr(paper, "extract_pages", lambda p: calls.append(p) or real(p))
    first = load_paper(store, "a1", path)
    second = load_paper(store, "a1", path)
    assert len(calls) == 1
    assert first.pages == second.pages and first.outline == [("Intro", 2)]
    assert first.page_count == 3 and first.has_text is True
    store.close()
    again = load_paper(ReaderStore(tmp_path / "data"), "a1", path)
    assert again.pages == first.pages
    assert len(calls) == 1  # survives a restart


def test_a_scan_is_reported_as_having_no_text(tmp_path):
    store = ReaderStore(tmp_path / "data")
    loaded = load_paper(store, "a1", write(tmp_path, pages=["", ""]))
    assert loaded.has_text is False and loaded.page_count == 2
