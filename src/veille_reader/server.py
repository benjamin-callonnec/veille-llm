"""Local reader server: item metadata, cached arXiv PDFs and the reader front. Loopback only."""

import json
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from veille_reader.pdf import Fetcher, PdfError, arxiv_id, default_fetcher, ensure_pdf
from veille_reader.storage import ReaderStore

LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def _load_items(catalogue_path: Path) -> dict[str, dict]:
    try:
        raw = json.loads(catalogue_path.read_text(encoding="utf-8"))
        items = raw["items"]
        return {str(i["id"]): i for i in items if isinstance(i, dict) and "id" in i}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"cannot read catalogue {catalogue_path}: {exc}") from exc


def _hostname(header: str) -> str:
    if header.startswith("["):
        return header.split("]")[0] + "]"
    return header.rsplit(":", 1)[0] if ":" in header else header


def _cross_site(request: Request) -> bool:
    """A page on another origin must not drive the server (it has side effects: downloads)."""
    if request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}:
        return True
    origin = request.headers.get("origin")
    if origin is None:
        return False
    host = urlsplit(origin).netloc
    return host != request.headers.get("host", "")


def create_app(
    data_dir: Path,
    catalogue_path: Path,
    static_dir: Path | None = None,
    fetch: Fetcher = default_fetcher,
) -> FastAPI:
    items = _load_items(catalogue_path)
    store = ReaderStore(data_dir)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_only(request: Request, call_next):  # noqa: ANN001, ANN202
        if _hostname(request.headers.get("host", "")) not in LOCAL_HOSTS:
            return JSONResponse({"reason": "forbidden_host"}, status_code=403)
        if _cross_site(request):
            return JSONResponse({"reason": "cross_site"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        return response

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/items/{item_id}")
    def item(item_id: str):  # noqa: ANN202
        found = items.get(item_id)
        if found is None:
            return JSONResponse({"reason": "unknown_item"}, status_code=404)
        return {
            "id": item_id,
            "title": str(found.get("title", "")),
            "hook": str(found.get("hook", "")),
            "url": str(found.get("url", "")),
            "type": str(found.get("type", "")),
            "has_pdf": arxiv_id(str(found.get("url", ""))) is not None,
        }

    @app.get("/api/items/{item_id}/pdf")
    def item_pdf(item_id: str):  # noqa: ANN202
        found = items.get(item_id)
        if found is None:
            return JSONResponse({"reason": "unknown_item"}, status_code=404)
        try:
            path = ensure_pdf(store, item_id, str(found.get("url", "")), fetch)
        except PdfError as exc:
            status = 404 if exc.reason == "no_pdf" else 502
            return JSONResponse({"reason": exc.reason}, status_code=status)
        return FileResponse(path, media_type="application/pdf")

    @app.get("/catalogue.json")
    def catalogue() -> FileResponse:
        return FileResponse(catalogue_path, media_type="application/json")

    if static_dir is not None:
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app
