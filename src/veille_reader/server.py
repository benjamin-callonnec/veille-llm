"""Local reader server: item metadata, cached arXiv PDFs and the reader front. Loopback only."""

import asyncio
import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from starlette.requests import HTTPConnection

from veille_reader import events
from veille_reader.asking import ASK_TIMEOUT, MAX_REPLY, AskBroker
from veille_reader.chat import stream_turn
from veille_reader.compaction import Summarizer
from veille_reader.events import AgentRunner
from veille_reader.images import IMAGE_ID, ImageError, decode_images
from veille_reader.limits import AgentLimits
from veille_reader.memory import MAX_NOTES, StoreMemory
from veille_reader.paper import PaperError, load_paper
from veille_reader.pdf import Fetcher, PdfError, arxiv_id, default_fetcher, ensure_pdf
from veille_reader.quiz import (
    MAX_ANSWER,
    MAX_FOCUS,
    MAX_GIVEN,
    AnswerError,
    Grader,
    QuizError,
    QuizMaker,
    answer_quiz,
    create_quiz,
    quiz_after_turn,
    recent_turns,
    view_of,
    with_results,
)
from veille_reader.reports import ReportTools, export_name, with_csp
from veille_reader.skills import load_skills
from veille_reader.skills_sync import default_fetcher as default_skills_fetcher
from veille_reader.skills_sync import sync_skills
from veille_reader.storage import ReaderStore
from veille_reader.structure import load_structure
from veille_reader.tools import PaperTools
from veille_reader.voice import CLOSE_POLICY, VoiceEngine, serve

TOOLS_TIMEOUT = 45.0  # seconds to get the paper ready (PDF download and text extraction)
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


class ImageIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    data: str = Field(max_length=8_000_000)  # base64, checked again once decoded


class RestoreIn(BaseModel):
    version: int = Field(ge=1)


class MessageIn(BaseModel):
    kind: Literal["text", "ask_agent"]
    text: str | None = Field(default=None, max_length=8000)
    raise_limit: bool = False
    quote: QuoteIn | None = None
    question: str | None = Field(default=None, max_length=8000)
    images: list[ImageIn] = Field(default_factory=list, max_length=20)
    skill: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]{0,39}$")

    @model_validator(mode="after")
    def complete(self) -> Self:
        if self.kind == "text" and not ((self.text or "").strip() or self.images):
            raise ValueError("text is required")
        if self.kind == "ask_agent" and self.images:
            raise ValueError("images go with a plain message")
        if self.kind == "ask_agent" and not (self.quote and (self.question or "").strip()):
            raise ValueError("quote and question are required")
        return self


async def _no_agent(request):  # noqa: ANN001, ANN202
    yield events.error("failed", "no agent is configured")


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def not_blank(self) -> Self:
        if not self.text.strip():
            raise ValueError("a note cannot be blank")
        self.text = self.text.strip()
        return self


class QuizIn(BaseModel):
    kind: Literal["any", "choice", "multi", "truefalse", "cloze", "order", "free"] = "any"
    focus: str = Field(default="", max_length=MAX_FOCUS)


class QuizAnswerIn(BaseModel):
    choice: int | None = Field(default=None, ge=0, le=3)
    text: str | None = Field(default=None, max_length=MAX_ANSWER)
    choices: list[int] | None = Field(default=None, max_length=5)
    words: list[Annotated[str, Field(max_length=MAX_GIVEN)]] | None = Field(
        default=None, max_length=2
    )
    order: list[int] | None = Field(default=None, max_length=5)


class RegenerateIn(BaseModel):
    raise_limit: bool = False


class AskAnswerIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_REPLY)

    @model_validator(mode="after")
    def not_blank(self) -> Self:
        if not self.text.strip():
            raise ValueError("an answer cannot be blank")
        self.text = self.text.strip()
        return self


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


def _cross_site(request: HTTPConnection, dev_origins: frozenset[str] = frozenset()) -> bool:
    """A page on another origin must not drive the server (it has side effects: downloads)."""
    if request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}:
        return True
    origin = request.headers.get("origin")
    if origin is None:
        return False
    if origin in dev_origins:
        return False
    host = urlsplit(origin).netloc
    return host != request.headers.get("host", "")


def create_app(
    data_dir: Path,
    catalogue_path: Path,
    static_dir: Path | None = None,
    fetch: Fetcher = default_fetcher,
    runner: AgentRunner | None = None,
    dev_origins: set[str] | frozenset[str] = frozenset(),
    dev_front: str | None = None,
    model: str | None = None,
    agent_limits: AgentLimits | None = None,
    tools_factory: Callable[[str, dict], tuple[PaperTools | None, list[str]]] | None = None,
    summarizer: Summarizer | None = None,
    quiz_maker: QuizMaker | None = None,
    grader: Grader | None = None,
    voice_engine: VoiceEngine | None = None,
    ask_timeout: float = ASK_TIMEOUT,
    skills_dir: Path | None = None,
    skills_fetch: Fetcher | None = None,
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
    skills_cache = skills_dir or data_dir / "skills"
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.streaming = set()
    app.state.store = store
    app.state.runner = runner or _no_agent
    app.state.asks = AskBroker()

    @app.middleware("http")
    async def local_only(request: Request, call_next):  # noqa: ANN001, ANN202
        if _hostname(request.headers.get("host", "")) not in LOCAL_HOSTS:
            return JSONResponse({"reason": "forbidden_host"}, status_code=403)
        if _cross_site(request, frozenset(dev_origins)):
            return JSONResponse({"reason": "cross_site"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        return response

    @app.websocket("/api/voice")
    async def voice(ws: WebSocket) -> None:
        # the http middleware does not see WebSockets: same loopback and same-origin rules here
        if _hostname(ws.headers.get("host", "")) not in LOCAL_HOSTS or _cross_site(
            ws, frozenset(dev_origins)
        ):
            await ws.close(code=CLOSE_POLICY)
            return
        await ws.accept()
        await serve(ws, voice_engine)

    def unknown(reason: str = "unknown_item") -> JSONResponse:
        return JSONResponse({"reason": reason}, status_code=404)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", **({"model": model} if model else {})}

    @app.get("/api/items/{item_id}")
    def item(item_id: str):  # noqa: ANN202
        found = current_items().get(item_id)
        if found is None:
            return unknown()
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
            return unknown()
        try:
            path = ensure_pdf(store, item_id, str(found.get("url", "")), fetch)
        except PdfError as exc:
            status = 404 if exc.reason == "no_pdf" else 502
            return JSONResponse({"reason": exc.reason}, status_code=status)
        return FileResponse(path, media_type="application/pdf")

    @app.get("/api/items/{item_id}/structure")
    def item_structure(item_id: str):  # noqa: ANN202
        found = current_items().get(item_id)
        if found is None:
            return unknown()
        try:
            path = ensure_pdf(store, item_id, str(found.get("url", "")), fetch)
        except PdfError as exc:
            status = 404 if exc.reason == "no_pdf" else 502
            return JSONResponse({"reason": exc.reason}, status_code=status)
        result = load_structure(store, item_id, path)
        if result is None:
            return JSONResponse({"reason": "no_structure"}, status_code=404)
        return result.to_dict()

    @app.get("/api/items/{item_id}/images/{image_id}")
    def item_image(item_id: str, image_id: str):  # noqa: ANN202
        if item_id not in current_items() or not IMAGE_ID.fullmatch(image_id):
            return unknown()
        stored = store.image(item_id, image_id)
        if stored is None:
            return unknown()
        data, mime = stored
        return Response(
            data,
            media_type=mime,
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": "inline",
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        )

    @app.get("/api/items/{item_id}/highlights")
    def list_highlights(item_id: str):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        return store.highlights(item_id)

    @app.post("/api/items/{item_id}/highlights", status_code=201)
    def add_highlight(item_id: str, body: HighlightIn):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        hid = store.add_highlight(item_id, body.page, body.color, body.text, body.rects)
        return next(h for h in store.highlights(item_id) if h["id"] == hid)

    @app.delete("/api/items/{item_id}/highlights/{highlight_id}")
    def delete_highlight(item_id: str, highlight_id: int):  # noqa: ANN202
        if not store.delete_highlight(item_id, highlight_id):
            return unknown("unknown_highlight")
        return Response(status_code=204)

    @app.get("/api/items/{item_id}/reports")
    def list_reports(item_id: str):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        return store.reports(item_id)

    @app.get("/api/items/{item_id}/reports/{report_id}")
    def get_report(item_id: str, report_id: int, version: int | None = None):  # noqa: ANN202
        view = store.report(item_id, report_id, version)
        return view if view is not None else unknown("unknown_report")

    @app.post("/api/items/{item_id}/reports/{report_id}/restore", status_code=201)
    def restore_report(item_id: str, report_id: int, body: RestoreIn):  # noqa: ANN202
        saved = store.restore_report(item_id, report_id, body.version)
        return saved if saved is not None else unknown("unknown_report")

    @app.delete("/api/items/{item_id}/reports/{report_id}")
    def delete_report(item_id: str, report_id: int):  # noqa: ANN202
        if not store.delete_report(item_id, report_id):
            return unknown("unknown_report")
        return Response(status_code=204)

    @app.get("/api/items/{item_id}/reports/{report_id}/export")
    def export_report(item_id: str, report_id: int, version: int | None = None):  # noqa: ANN202
        view = store.report(item_id, report_id, version)
        if view is None:
            return unknown("unknown_report")
        name = export_name(view["title"])
        return Response(
            with_csp(view["html"]),
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

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
        if cid in app.state.streaming:
            return JSONResponse({"reason": "busy"}, status_code=409)
        if not store.delete_conversation(item_id, cid):
            return unknown("unknown_conversation")
        return Response(status_code=204)

    @app.get("/api/items/{item_id}/conversations/{cid}/messages")
    def conversation_messages(item_id: str, cid: int):  # noqa: ANN202
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        return with_results(store, item_id, _asks_shown(store.messages(cid), cid))

    def _asks_shown(messages: list[dict], cid: int) -> list[dict]:
        """A card still pending that no live turn waits for (server restarted) shows as expired."""
        for m in messages:
            card = m["content"]
            if (
                m["kind"] == "ask"
                and card.get("status") == "pending"
                and not app.state.asks.is_open(cid, str(card.get("id")))
            ):
                m["content"] = {**card, "status": "expired"}
        return messages

    @app.post("/api/items/{item_id}/conversations/{cid}/asks/{ask_id}/answer")
    async def answer_ask(item_id: str, cid: int, ask_id: str, body: AskAnswerIn):  # noqa: ANN202
        """The user's reply to a question of the tutor; the paused turn goes on with it."""
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        if app.state.asks.answer(cid, ask_id, body.text) != "ok":
            return unknown("unknown_ask")
        return Response(status_code=204)

    @app.get("/api/items/{item_id}/conversations/{cid}/trace")
    def conversation_trace(item_id: str, cid: int):  # noqa: ANN202
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        return store.traces(cid)

    @app.get("/api/items/{item_id}/conversations/{cid}/export")
    def export_conversation(item_id: str, cid: int):  # noqa: ANN202
        markdown = store.export_markdown(item_id, cid)
        if markdown is None:
            return unknown("unknown_conversation")
        return Response(markdown, media_type="text/markdown; charset=utf-8")

    def default_tools(item_id: str, item: dict) -> tuple[PaperTools | None, list[str]]:
        """The tutor's tools for this paper (from the cached PDF) and its pinned notes."""
        notes = [n["text"] for n in store.memory_notes(item_id)]
        try:
            path = ensure_pdf(store, item_id, str(item.get("url", "")), fetch)
            paper = load_paper(store, item_id, path)
        except (PdfError, PaperError):
            return None, notes
        return PaperTools(paper, store.highlights(item_id), StoreMemory(store, item_id)), notes

    async def run_turn(  # noqa: ANN202
        item_id: str,
        cid: int,
        kind: str | None,
        content: dict | None,
        raise_limit: bool = False,
        skill_name: str | None = None,
    ):
        streaming: set[int] = app.state.streaming
        streaming.add(cid)

        item = current_items()[item_id]
        catalogue_skills = load_skills(skills_cache)

        async def body():  # noqa: ANN202
            try:
                try:
                    tools, notes = await asyncio.wait_for(
                        asyncio.to_thread(tools_factory or default_tools, item_id, item),
                        TOOLS_TIMEOUT,
                    )
                except Exception:  # noqa: BLE001 - the chat still works from the summary
                    tools, notes = None, []

                async def after_turn(text: str) -> None:
                    try:
                        await quiz_after_turn(
                            store, quiz_maker, item_id, item, cid,
                            getattr(tools, "paper", None), text,
                        )  # fmt: skip
                    except sqlite3.IntegrityError:
                        pass  # the conversation was deleted meanwhile

                async for line in stream_turn(
                    store,
                    app.state.runner,
                    item,
                    cid,
                    kind,
                    content,
                    tools=tools,
                    notes=notes,
                    agent_limits=agent_limits,
                    model=model or "",
                    raise_limit=raise_limit,
                    summarizer=summarizer,
                    after_turn=after_turn,
                    asks=app.state.asks,
                    ask_timeout=ask_timeout,
                    skills=catalogue_skills,
                    reports=ReportTools(store, item_id),
                    skill=next((s for s in catalogue_skills if s.name == skill_name), None),
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
            content = {"text": body.text or ""}
            if body.skill:
                content["skill"] = body.skill  # remembered, so Regenerate runs it again
            try:
                images = decode_images([i.model_dump() for i in body.images])
            except ImageError as exc:
                status = 413 if exc.reason == "image_too_large" else 400
                return JSONResponse({"reason": exc.reason, "message": str(exc)}, status_code=status)
            if images:
                for image in images:
                    store.save_image(item_id, image)
                content["images"] = [
                    {"id": i.id, "mime": i.mime, **({"name": i.name} if i.name else {})}
                    for i in images
                ]
        return await run_turn(item_id, cid, body.kind, content, body.raise_limit, body.skill)

    @app.post("/api/items/{item_id}/conversations/{cid}/regenerate")
    async def regenerate(item_id: str, cid: int, body: RegenerateIn | None = None):  # noqa: ANN202
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        if cid in app.state.streaming:
            return JSONResponse({"reason": "busy"}, status_code=409)
        store.replace_last_assistant(cid)
        spoken = [m for m in store.messages(cid) if m["role"] in ("user", "assistant")]
        if not spoken or spoken[-1]["role"] != "user":
            return JSONResponse({"reason": "nothing_to_regenerate"}, status_code=400)
        last_user = next((m for m in reversed(spoken) if m["role"] == "user"), None)
        skill = (last_user or {}).get("content", {}).get("skill")
        return await run_turn(item_id, cid, None, None, bool(body and body.raise_limit), skill)

    @app.post("/api/items/{item_id}/conversations/{cid}/quizzes", status_code=201)
    async def start_quiz(item_id: str, cid: int, body: QuizIn):  # noqa: ANN202
        """Make a quiz on the paper (or the part just discussed); the card is added to the chat."""
        if store.conversation(item_id, cid) is None:
            return unknown("unknown_conversation")
        if quiz_maker is None:
            return JSONResponse({"reason": "no_quiz_agent"}, status_code=503)
        if cid in app.state.streaming:
            return JSONResponse({"reason": "busy"}, status_code=409)
        item = current_items()[item_id]
        app.state.streaming.add(cid)  # before any await: one quiz at a time, none during an answer
        try:
            try:
                tools, _ = await asyncio.wait_for(
                    asyncio.to_thread(tools_factory or default_tools, item_id, item),
                    TOOLS_TIMEOUT,
                )
            except Exception:  # noqa: BLE001 - reported as "no paper"
                tools = None
            paper = getattr(tools, "paper", None)
            if paper is None:
                return JSONResponse({"reason": "no_paper"}, status_code=422)
            message = await create_quiz(
                store, quiz_maker, item_id, item, cid, paper, body.kind, body.focus.strip(),
                recent_turns(store, cid),
            )  # fmt: skip
        except QuizError as exc:
            return JSONResponse({"reason": "quiz_failed", "message": str(exc)}, status_code=502)
        finally:
            app.state.streaming.discard(cid)
        return with_results(store, item_id, [message])[0]

    @app.get("/api/items/{item_id}/quizzes")
    def quiz_history(item_id: str, conversation: int | None = None):  # noqa: ANN202
        """Answered quizzes of the paper (newest first) and the score, per paper and session."""
        if item_id not in current_items():
            return unknown()
        return {
            "history": store.quiz_history(item_id),
            "score": {
                "paper": store.quiz_score(item_id),
                "session": store.quiz_score(item_id, conversation)
                if conversation is not None
                else None,
            },
        }

    @app.get("/api/items/{item_id}/quizzes/{quiz_id}")
    def get_quiz(item_id: str, quiz_id: int):  # noqa: ANN202
        quiz = store.quiz(item_id, quiz_id)
        if quiz is None:
            return unknown("unknown_quiz")
        return view_of(store, quiz)

    @app.post("/api/items/{item_id}/quizzes/{quiz_id}/answer")
    async def answer(item_id: str, quiz_id: int, body: QuizAnswerIn):  # noqa: ANN202
        quiz = store.quiz(item_id, quiz_id)
        if quiz is None or item_id not in current_items():
            return unknown("unknown_quiz")
        try:
            return await answer_quiz(
                store,
                grader,
                current_items()[item_id],
                quiz,
                body.choice,
                body.text,
                choices=body.choices,
                words=body.words,
                order=body.order,
            )
        except AnswerError as exc:
            status = {"bad_answer": 422, "already_answered": 409, "no_grader": 503}
            return JSONResponse({"reason": exc.reason}, status_code=status.get(exc.reason, 502))

    @app.get("/api/items/{item_id}/memory")
    def list_notes(item_id: str):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        return store.memory_notes(item_id)

    @app.post("/api/items/{item_id}/memory", status_code=201)
    def add_note(item_id: str, body: NoteIn):  # noqa: ANN202
        if item_id not in current_items():
            return unknown()
        note = store.add_memory_note(item_id, body.text, limit=MAX_NOTES)
        if note is None:
            return JSONResponse({"reason": "memory_full"}, status_code=409)
        return note

    @app.put("/api/items/{item_id}/memory/{note_id}")
    def edit_note(item_id: str, note_id: int, body: NoteIn):  # noqa: ANN202
        if not store.update_memory_note(item_id, note_id, body.text):
            return unknown("unknown_note")
        return next(n for n in store.memory_notes(item_id) if n["id"] == note_id)

    @app.delete("/api/items/{item_id}/memory/{note_id}")
    def delete_note(item_id: str, note_id: int):  # noqa: ANN202
        if not store.delete_memory_note(item_id, note_id):
            return unknown("unknown_note")
        return Response(status_code=204)

    @app.get("/api/skills")
    def list_skills() -> list[dict]:
        return [
            {"name": s.name, "description": s.description, "tools": list(s.tools)}
            for s in load_skills(skills_cache)
        ]

    @app.post("/api/skills/sync")
    async def sync_skills_now() -> dict:
        count = await asyncio.to_thread(
            sync_skills, skills_cache, skills_fetch or default_skills_fetcher
        )
        return {"count": count}

    @app.get("/catalogue.json")
    def catalogue() -> FileResponse:
        return FileResponse(catalogue_path, media_type="application/json")

    if dev_front:
        # make reader: the pages live on the hot-reload dev server, wherever you opened the API
        front = dev_front.rstrip("/")
        for path, target in (
            ("/", "/"),
            ("/index.html", "/"),
            ("/reader.html", "/reader.html"),
        ):
            app.add_api_route(
                path,
                lambda target=target: RedirectResponse(front + target, status_code=307),
                methods=["GET"],
                include_in_schema=False,
            )

    if static_dir is not None:
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app
