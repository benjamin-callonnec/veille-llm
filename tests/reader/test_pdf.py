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


def test_redirects_leaving_arxiv_are_refused():
    from urllib.request import Request

    from veille_reader.pdf import _ArxivOnly

    handler = _ArxivOnly()
    req = Request("https://arxiv.org/pdf/2401.01234")
    for target in (
        "https://evil.example/x.pdf",
        "http://arxiv.org/pdf/2401.01234",
        "https://arxiv.org.evil.com/pdf/2401.01234",
        "https://arxiv.org:8443/pdf/2401.01234",
    ):
        with pytest.raises(OSError):
            handler.redirect_request(req, None, 302, "Found", {}, target)
    ok = handler.redirect_request(req, None, 302, "Found", {}, "https://arxiv.org/pdf/2401.01234v2")
    assert ok is not None


def test_default_fetcher_has_an_overall_deadline(monkeypatch):
    from veille_reader import pdf

    class Slow:
        def read(self, n):
            return b"x"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class Opener:
        def open(self, url, timeout):
            return Slow()

    monkeypatch.setattr(pdf.urllib.request, "build_opener", lambda *h: Opener())
    monkeypatch.setattr(pdf, "DEADLINE_SECONDS", 0)
    with pytest.raises(TimeoutError):
        pdf.default_fetcher("https://arxiv.org/pdf/2401.01234")


def test_cached_pdf_is_not_blocked_by_another_download(store):
    ensure_pdf(store, "cached", "https://arxiv.org/abs/2401.00001", lambda u: PDF)
    started, release = threading.Event(), threading.Event()

    def slow(url):
        started.set()
        release.wait(5)
        return PDF

    worker = threading.Thread(
        target=lambda: ensure_pdf(store, "slow", "https://arxiv.org/abs/2401.00002", slow)
    )
    worker.start()
    assert started.wait(5)
    done = threading.Event()

    def read_cached():
        ensure_pdf(store, "cached", "https://arxiv.org/abs/2401.00001", lambda u: PDF)
        done.set()

    reader = threading.Thread(target=read_cached)
    reader.start()
    finished = done.wait(2)
    release.set()
    worker.join()
    reader.join()
    assert finished
