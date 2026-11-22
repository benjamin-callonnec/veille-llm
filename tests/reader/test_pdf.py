import threading

import pytest

from veille_reader.pdf import MAX_BYTES, PdfError, arxiv_id, ensure_pdf, pdf_url
from veille_reader.storage import ReaderStore

PDF = b"%PDF-1.7\nbody"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://arxiv.org/abs/2401.01234", "2401.01234"),
        ("https://arxiv.org/abs/2401.01234v3", "2401.01234v3"),
        ("https://arxiv.org/pdf/2401.01234v2", "2401.01234v2"),
        ("https://arxiv.org/pdf/2401.01234v2.pdf", "2401.01234v2"),
        ("https://arxiv.org/abs/hep-th/9901001", "hep-th/9901001"),
        ("https://arxiv.org/abs/2401.01234/", "2401.01234"),
        ("https://arxiv.org/abs/2401.01234?context=cs#top", "2401.01234"),
    ],
)
def test_arxiv_id_accepts(url, expected):
    assert arxiv_id(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://arxiv.org.evil.com/abs/2401.01234",
        "https://evilarxiv.org/abs/2401.01234",
        "http://arxiv.org/abs/2401.01234",
        "https://arxiv.org/abs/../../etc/passwd",
        "https://arxiv.org/abs/%2e%2e/x",
        "https://arxiv.org/abs/2401.01234/../../x",
        "https://example.org/blog/post",
        "",
    ],
)
def test_arxiv_id_rejects(url):
    assert arxiv_id(url) is None


def test_pdf_url():
    assert pdf_url("2401.01234v2") == "https://arxiv.org/pdf/2401.01234v2"


@pytest.fixture
def store(tmp_path):
    return ReaderStore(tmp_path / "data")


def test_downloads_once_and_reuses_cache(store):
    calls = []

    def fetch(url):
        calls.append(url)
        return PDF

    first = ensure_pdf(store, "i1", "https://arxiv.org/abs/2401.01234", fetch)
    second = ensure_pdf(store, "i1", "https://arxiv.org/abs/2401.01234", fetch)
    assert first == second
    assert first.parent == store.pdfs_dir
    assert first.read_bytes() == PDF
    assert calls == ["https://arxiv.org/pdf/2401.01234"]


def test_old_style_id_stays_inside_pdfs_dir(store):
    path = ensure_pdf(store, "i1", "https://arxiv.org/abs/hep-th/9901001", lambda u: PDF)
    assert path.parent == store.pdfs_dir
    assert path.name == "hep-th_9901001.pdf"


def test_non_arxiv_has_no_pdf_and_no_fetch(store):
    def fetch(url):
        raise AssertionError("must not fetch")

    with pytest.raises(PdfError) as err:
        ensure_pdf(store, "i1", "https://example.org/post", fetch)
    assert err.value.reason == "no_pdf"


def test_too_large(store):
    with pytest.raises(PdfError) as err:
        ensure_pdf(
            store, "i1", "https://arxiv.org/abs/2401.01234", lambda u: b"%PDF" + b"0" * MAX_BYTES
        )
    assert err.value.reason == "too_large"


def test_not_a_pdf(store):
    with pytest.raises(PdfError) as err:
        ensure_pdf(store, "i1", "https://arxiv.org/abs/2401.01234", lambda u: b"<html>")
    assert err.value.reason == "not_pdf"


def test_fetch_failure_leaves_nothing(store):
    def fetch(url):
        raise OSError("down")

    with pytest.raises(PdfError) as err:
        ensure_pdf(store, "i1", "https://arxiv.org/abs/2401.01234", fetch)
    assert err.value.reason == "fetch_failed"
    assert list(store.pdfs_dir.iterdir()) == []
    assert store.pdf_file("i1") is None


def test_concurrent_requests_leave_one_valid_file(store):
    errors = []

    def run():
        try:
            ensure_pdf(store, "i1", "https://arxiv.org/abs/2401.01234", lambda u: PDF)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert [p.name for p in store.pdfs_dir.iterdir()] == ["2401.01234.pdf"]
    assert (store.pdfs_dir / "2401.01234.pdf").read_bytes() == PDF
