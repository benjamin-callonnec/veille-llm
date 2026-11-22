"""Resolve a catalogue item to its arXiv PDF and cache it locally (never redistributed)."""

import os
import re
import tempfile
import threading
import time
import urllib.request
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

from veille_reader.storage import ReaderStore

MAX_BYTES = 50 * 1024 * 1024
TIMEOUT_SECONDS = 30
DEADLINE_SECONDS = 120
CHUNK = 64 * 1024
ARXIV_HOST = "arxiv.org"

_NEW_ID = r"\d{4}\.\d{4,5}(?:v\d+)?"
_OLD_ID = r"[a-z\-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?"
_PATH = re.compile(rf"^/(?:abs|pdf)/({_NEW_ID}|{_OLD_ID})(?:\.pdf)?/?$")

Fetcher = Callable[[str], bytes]
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(name: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(name, threading.Lock())


class PdfError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def arxiv_id(url: str) -> str | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme != "https" or parts.hostname != ARXIV_HOST or parts.port is not None:
        return None
    match = _PATH.match(parts.path)
    return match.group(1) if match else None


def pdf_url(identifier: str) -> str:
    return f"https://{ARXIV_HOST}/pdf/{identifier}"


class _ArxivOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        parts = urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname != ARXIV_HOST or parts.port is not None:
            raise OSError(f"redirect outside {ARXIV_HOST} refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_fetcher(url: str) -> bytes:
    opener = urllib.request.build_opener(_ArxivOnly)
    deadline = time.monotonic() + DEADLINE_SECONDS
    data = bytearray()
    with opener.open(url, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        while len(data) <= MAX_BYTES:
            if time.monotonic() >= deadline:
                raise TimeoutError("download exceeded its deadline")
            chunk = response.read(min(CHUNK, MAX_BYTES + 1 - len(data)))
            if not chunk:
                break
            data += chunk
    return bytes(data)


def ensure_pdf(
    store: ReaderStore, item_id: str, item_url: str, fetch: Fetcher = default_fetcher
) -> Path:
    identifier = arxiv_id(item_url)
    if identifier is None:
        raise PdfError("no_pdf")
    name = identifier.replace("/", "_") + ".pdf"
    path = store.pdfs_dir / name
    if path.is_file() and store.pdf_file(item_id) == name:
        return path
    with _lock_for(name):
        if path.is_file() and store.pdf_file(item_id) == name:
            return path
        try:
            data = fetch(pdf_url(identifier))
        except Exception as exc:
            raise PdfError("fetch_failed") from exc
        if len(data) > MAX_BYTES:
            raise PdfError("too_large")
        if not data.startswith(b"%PDF"):
            raise PdfError("not_pdf")
        fd, tmp = tempfile.mkstemp(dir=store.pdfs_dir, suffix=".part")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, path)
        finally:
            Path(tmp).unlink(missing_ok=True)
        store.record_pdf(item_id, name)
    return path
