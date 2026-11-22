"""Local reader server: item metadata, cached arXiv PDFs and the reader front. Loopback only."""

import json
from pathlib import Path
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from veille_reader import events
from veille_reader.chat import stream_turn
from veille_reader.events import AgentRunner
from veille_reader.pdf import Fetcher, PdfError, arxiv_id, default_fetcher, ensure_pdf
from veille_reader.storage import ReaderStore

LOCAL_HOSTS = {"127.0.0.1", "localhost"}


Unit = Annotated[float, Field(ge=0, le=1)]


class ConversationIn(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=200)


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class QuoteIn(BaseModel):
    text: str = Field(max_length=5000)
    page: int = Field(ge=1)
    rects: list[list[float]] = Field(default_factory=list, max_length=200)


class MessageIn(BaseModel):
    kind: Literal["text", "ask_agent"]
    text: str | None = Field(default=None, max_length=8000)
    quote: QuoteIn | None = None
    question: str | None = Field(default=None, max_length=8000)

    @model_validator(mode="after")
    def complete(self) -> Self:
        if self.kind == "text" and not (self.text or "").strip():
            raise ValueError("text is required")
        if self.kind == "ask_agent" and not (self.quote and (self.question or "").strip()):
            raise ValueError("quote and question are required")
        return self


async def _no_agent(request):  # noqa: ANN001, ANN202
    yield events.error("failed", "no agent is configured")


class HighlightIn(BaseModel):
    page: int = Field(ge=1)
    color: Literal["yellow", "green", "red"]
    text: str = Field(max_length=5000)
    rects: list[Annotated[list[Unit], Field(min_length=4, max_length=4)]] = Field(max_length=200)


def _load_items(catalogue_path: Path) -> dict[str, dict]:
    try:
        raw = json.loads(catalogue_path.read_text(encoding="utf-8"))
        items = raw["items"]
        if not isinstance(items, list):
            raise TypeError("items is not a list")
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
    runner: AgentRunner | None = None,
) -> FastAPI:
    loaded = {"items": _load_items(catalogue_path), "mtime": catalogue_path.stat().st_mtime_ns}

    def current_items() -> dict[str, dict]:
        """Reload when veille-core rewrites the catalogue; keep the old one if it is unreadable."""
        try:
            mtime = catalogue_path.stat().st_mtime_ns
            if mtime != loaded["mtime"]:
                loaded["items"], loaded["mtime"] = _load_items(catalogue_path), mtime
        except (OSError, ValueError):
            pass
        return loaded["items"]

    store = ReaderStore(data_dir)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.streaming = set()
    app.state.runner = runner or _no_agent

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
        found = current_items().get(item_id)
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
        found = current_items().get(item_id)
        if found is None:
            return JSONResponse({"reason": "unknown_item"}, status_code=404)
        try:
            path = ensure_pdf(store, item_id, str(found.get("url", "")), fetch)
        except PdfError as exc:
            status = 404 if exc.reason == "no_pdf" else 502
            return JSONResponse({"reason": exc.reason}, status_code=status)
        return FileResponse(path, media_type="application/pdf")

    @app.get("/api/items/{item_id}/highlights")
    def list_highlights(item_id: str):  # noqa: ANN202
        if item_id not in current_items():
            return JSONResponse({"reason": "unknown_item"}, status_code=404)
        return store.highlights(item_id)

    @app.post("/api/items/{item_id}/highlights", status_code=201)
    def add_highlight(item_id: str, body: HighlightIn):  # noqa: ANN202
        if item_id not in current_items():
            return JSONResponse({"reason": "unknown_item"}, status_code=404)
        hid = store.add_highlight(item_id, body.page, body.color, body.text, body.rects)
        return next(h for h in store.highlights(item_id) if h["id"] == hid)

    @app.delete("/api/items/{item_id}/highlights/{highlight_id}")
    def delete_highlight(item_id: str, highlight_id: int):  # noqa: ANN202
        if not store.delete_highlight(item_id, highlight_id):
            return JSONResponse({"reason": "unknown_highlight"}, status_code=404)
        return Response(status_code=204)

    def unknown(reason: str = "unknown_item") -> JSONResponse:
        return JSONResponse({"reason": reason}, status_code=404)

    @app.get("/api/items/{item_id}/conversations")
    def list_conversations(item_id: str):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        return store.conversations(item_id)

    @app.post("/api/items/{item_id}/conversations", status_code=201)
    def create_conversation(item_id: str, body: ConversationIn):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        return store.create_conversation(item_id, body.title)

    @app.patch("/api/items/{item_id}/conversations/{cid}")
    def rename_conversation(item_id: str, cid: int, body: TitleIn):  # noqa: ANN202
        if not store.rename_conversation(item_id, cid, body.title):
            return unknown("unknown_conversation")
        return store.conversation(item_id, cid)

    @app.delete("/api/items/{item_id}/conversations/{cid}")
    def delete_conversation(item_id: str, cid: int):  # noqa: ANN202
        if not store.delete_conversation(item_id, cid):
            return unknown("unknown_conversation")
        return Response(status_code=204)

    @app.get("/api/items/{item_id}/conversations/{cid}/messages")
    def conversation_messages(item_id: str, cid: int):  # noqa: ANN202
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        return store.messages(cid)

    @app.get("/api/items/{item_id}/conversations/{cid}/export")
    def export_conversation(item_id: str, cid: int):  # noqa: ANN202
        markdown = store.export_markdown(item_id, cid)
        if markdown is None:
            return unknown("unknown_conversation")
        return Response(markdown, media_type="text/markdown; charset=utf-8")

    async def run_turn(item_id: str, cid: int, kind: str | None, content: dict | None):  # noqa: ANN202
        streaming: set[int] = app.state.streaming
        streaming.add(cid)

        async def body():  # noqa: ANN202
            try:
                async for line in stream_turn(
                    store, app.state.runner, current_items()[item_id], cid, kind, content
                ):
                    yield line
            finally:
                streaming.discard(cid)

        return StreamingResponse(
            body(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
        )

    @app.post("/api/items/{item_id}/conversations/{cid}/messages")
    async def send_message(item_id: str, cid: int, body: MessageIn):  # noqa: ANN202
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        if cid in app.state.streaming:
            return JSONResponse({"reason": "busy"}, status_code=409)
        if body.kind == "ask_agent":
            content = {"quote": body.quote.model_dump(), "question": body.question}
        else:
            content = {"text": body.text}
        return await run_turn(item_id, cid, body.kind, content)

    @app.post("/api/items/{item_id}/conversations/{cid}/regenerate")
    async def regenerate(item_id: str, cid: int):  # noqa: ANN202
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        if cid in app.state.streaming:
            return JSONResponse({"reason": "busy"}, status_code=409)
        store.replace_last_assistant(cid)
        messages = store.messages(cid)
        if not messages or messages[-1]["role"] != "user":
            return JSONResponse({"reason": "nothing_to_regenerate"}, status_code=400)
        return await run_turn(item_id, cid, None, None)

    @app.get("/catalogue.json")
    def catalogue() -> FileResponse:
        return FileResponse(catalogue_path, media_type="application/json")

    if static_dir is not None:
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app
