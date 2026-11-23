"""Local storage of the reader: one SQLite file and a PDF cache, all under one data dir."""

import functools
import hashlib
import inspect
import json
import re
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

from veille_reader.images import EXTENSIONS, IMAGE_ID, Image

MIGRATIONS: list[str] = [
    """
    CREATE TABLE papers (
        item_id TEXT PRIMARY KEY,
        pdf_file TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        color TEXT NOT NULL,
        text TEXT NOT NULL,
        rects TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX highlights_item ON highlights (item_id);
    """,
    """
    CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX conversations_item ON conversations (item_id);
    CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX messages_conversation ON messages (conversation_id, seq);
    """,
    """
    CREATE TABLE paper_text (
        item_id TEXT PRIMARY KEY,
        pages TEXT NOT NULL,
        outline TEXT NOT NULL,
        extracted_at TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE memory_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX memory_notes_item ON memory_notes (item_id);
    """,
    """
    ALTER TABLE conversations ADD COLUMN limit_raised INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        tools TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        model TEXT NOT NULL,
        stopped INTEGER NOT NULL,
        error_kind TEXT NOT NULL
    );
    CREATE INDEX traces_conversation ON traces (conversation_id);
    """,
    """
    ALTER TABLE memory_notes ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
    """,
    """
    CREATE TABLE quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        conversation_id INTEGER,
        created_at TEXT NOT NULL,
        spec TEXT NOT NULL
    );
    CREATE INDEX quizzes_item ON quizzes (item_id);
    CREATE TABLE quiz_answers (
        quiz_id INTEGER PRIMARY KEY REFERENCES quizzes(id) ON DELETE CASCADE,
        answered_at TEXT NOT NULL,
        answer TEXT NOT NULL,
        correct INTEGER NOT NULL,
        reasoning TEXT NOT NULL
    );
    """,
    """
    ALTER TABLE traces ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE traces ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
    """,
    """
    CREATE TABLE paper_structure (
        item_id TEXT PRIMARY KEY,
        extractor TEXT NOT NULL,
        data TEXT NOT NULL,
        extracted_at TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX reports_item ON reports (item_id);
    CREATE TABLE report_versions (
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        html TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (report_id, version)
    );
    """,
]
MAX_VERSIONS = 50  # versions kept per report; older ones are purged
MAX_HTML_CHARS = 400_000


_SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}")


def _safe_name(item_id: str) -> str:
    """A folder name for an item: the id itself when harmless, else a hash (no path tricks)."""
    if _SAFE_NAME.fullmatch(item_id):
        return item_id
    return hashlib.sha256(item_id.encode()).hexdigest()


class StorageError(Exception):
    pass


def _locked(method):  # noqa: ANN001, ANN202
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


def _synchronised(cls):  # noqa: ANN001, ANN202
    """One SQLite connection is shared by the event loop and worker threads: serialise every use."""
    for name, member in list(vars(cls).items()):
        if not name.startswith("__") and inspect.isfunction(member):
            setattr(cls, name, _locked(member))
    return cls


@_synchronised
class ReaderStore:
    def __init__(self, data_dir: Path) -> None:
        self._lock = threading.RLock()
        self.data_dir = data_dir
        self.pdfs_dir = data_dir / "pdfs"
        self.pdfs_dir.mkdir(parents=True, exist_ok=True)
        self._con = sqlite3.connect(data_dir / "reader.db", check_same_thread=False)
        self._con.execute("PRAGMA foreign_keys = ON")
        self._migrate()

    def _migrate(self) -> None:
        version = self.schema_version()
        if version > len(MIGRATIONS):
            raise StorageError(
                f"reader.db is version {version}, this code knows up to {len(MIGRATIONS)}"
            )
        for number in range(version, len(MIGRATIONS)):
            with self._con:
                self._con.executescript("BEGIN;" + MIGRATIONS[number])
                self._con.execute(f"PRAGMA user_version = {number + 1}")
                self._con.commit()

    def schema_version(self) -> int:
        return self._con.execute("PRAGMA user_version").fetchone()[0]

    def save_image(self, item_id: str, image: Image) -> None:
        """Keep an image, content addressed: <data>/images/<item>/<sha256>.<ext>. Never deleted
        with the conversation (a conversation can share an image with another one)."""
        folder = self.data_dir / "images" / _safe_name(item_id)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{image.id}.{EXTENSIONS[image.mime]}"
        if not path.exists():
            path.write_bytes(image.data)

    def image(self, item_id: str, image_id: str) -> tuple[bytes, str] | None:
        """The bytes and MIME type of a stored image, None if unknown (or a malformed id)."""
        if not IMAGE_ID.fullmatch(image_id):
            return None
        folder = self.data_dir / "images" / _safe_name(item_id)
        for mime, ext in EXTENSIONS.items():
            path = folder / f"{image_id}.{ext}"
            if path.is_file():
                return path.read_bytes(), mime
        return None

    def record_pdf(self, item_id: str, pdf_file: str) -> None:
        with self._con:
            self._con.execute(
                "INSERT OR REPLACE INTO papers (item_id, pdf_file, fetched_at) VALUES (?, ?, ?)",
                (item_id, pdf_file, datetime.now(UTC).isoformat()),
            )

    def pdf_file(self, item_id: str) -> str | None:
        row = self._con.execute(
            "SELECT pdf_file FROM papers WHERE item_id = ?", (item_id,)
        ).fetchone()
        return row[0] if row else None

    def add_highlight(
        self, item_id: str, page: int, color: str, text: str, rects: list[list[float]]
    ) -> int:
        with self._con:
            cursor = self._con.execute(
                "INSERT INTO highlights (item_id, page, color, text, rects, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (item_id, page, color, text, json.dumps(rects), datetime.now(UTC).isoformat()),
            )
        return int(cursor.lastrowid)

    def highlights(self, item_id: str) -> list[dict]:
        rows = self._con.execute(
            "SELECT id, page, color, text, rects, created_at FROM highlights"
            " WHERE item_id = ? ORDER BY page, id",
            (item_id,),
        ).fetchall()
        return [
            {
                "id": r[0],
                "page": r[1],
                "color": r[2],
                "text": r[3],
                "rects": json.loads(r[4]),
                "created_at": r[5],
            }
            for r in rows
        ]

    def delete_highlight(self, item_id: str, highlight_id: int) -> bool:
        with self._con:
            cursor = self._con.execute(
                "DELETE FROM highlights WHERE id = ? AND item_id = ?", (highlight_id, item_id)
            )
        return cursor.rowcount > 0

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    def _conversation_row(self, row: tuple) -> dict:
        return {
            "id": row[0],
            "item_id": row[1],
            "title": row[2],
            "created_at": row[3],
            "updated_at": row[4],
        }

    def create_conversation(self, item_id: str, title: str) -> dict:
        now = self._now()
        with self._con:
            cursor = self._con.execute(
                "INSERT INTO conversations (item_id, title, created_at, updated_at)"
                " VALUES (?, ?, ?, ?)",
                (item_id, title, now, now),
            )
        return {
            "id": int(cursor.lastrowid),
            "item_id": item_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
        }

    def conversations(self, item_id: str) -> list[dict]:
        rows = self._con.execute(
            "SELECT id, item_id, title, created_at, updated_at FROM conversations"
            " WHERE item_id = ? ORDER BY id DESC",
            (item_id,),
        ).fetchall()
        return [self._conversation_row(r) for r in rows]

    def conversation(self, item_id: str, conversation_id: int) -> dict | None:
        row = self._con.execute(
            "SELECT id, item_id, title, created_at, updated_at FROM conversations"
            " WHERE id = ? AND item_id = ?",
            (conversation_id, item_id),
        ).fetchone()
        return self._conversation_row(row) if row else None

    def rename_conversation(self, item_id: str, conversation_id: int, title: str) -> bool:
        with self._con:
            cursor = self._con.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND item_id = ?",
                (title, self._now(), conversation_id, item_id),
            )
        return cursor.rowcount > 0

    def delete_conversation(self, item_id: str, conversation_id: int) -> bool:
        with self._con:
            cursor = self._con.execute(
                "DELETE FROM conversations WHERE id = ? AND item_id = ?", (conversation_id, item_id)
            )
        return cursor.rowcount > 0

    def add_message(self, conversation_id: int, role: str, kind: str, content: dict) -> dict:
        now = self._now()
        with self._con:
            seq = self._con.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()[0]
            cursor = self._con.execute(
                "INSERT INTO messages (conversation_id, seq, role, kind, content, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (conversation_id, seq, role, kind, json.dumps(content), now),
            )
            self._con.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conversation_id)
            )
        return {
            "id": int(cursor.lastrowid),
            "seq": seq,
            "role": role,
            "kind": kind,
            "content": content,
            "created_at": now,
        }

    def update_message_content(self, message_id: int, content: dict) -> None:
        with self._con:
            self._con.execute(
                "UPDATE messages SET content = ? WHERE id = ?", (json.dumps(content), message_id)
            )

    def delete_messages(self, conversation_id: int, message_ids: list[int]) -> None:
        with self._con:
            self._con.executemany(
                "DELETE FROM messages WHERE id = ? AND conversation_id = ?",
                [(i, conversation_id) for i in message_ids],
            )

    def messages(self, conversation_id: int) -> list[dict]:
        rows = self._con.execute(
            "SELECT id, seq, role, kind, content, created_at FROM messages"
            " WHERE conversation_id = ? ORDER BY seq",
            (conversation_id,),
        ).fetchall()
        return [
            {
                "id": r[0],
                "seq": r[1],
                "role": r[2],
                "kind": r[3],
                "content": json.loads(r[4]),
                "created_at": r[5],
            }
            for r in rows
        ]

    def replace_last_assistant(self, conversation_id: int) -> None:
        """Drop the last answer (regenerate), the quiz cards and notices that follow it, and the
        question cards and note lines it produced (stored just before it)."""
        with self._con:
            rows = self._con.execute(
                "SELECT id, role, kind FROM messages WHERE conversation_id = ? ORDER BY seq DESC",
                (conversation_id,),
            ).fetchall()
            doomed: list[int] = []
            found = False
            for message_id, role, kind in rows:
                if not found:
                    doomed.append(message_id)
                    if role == "assistant":
                        found = True
                    elif not (role == "system" and kind in ("quiz", "notice")):
                        return
                elif role == "system" and kind in ("ask", "memory"):
                    doomed.append(message_id)
                else:
                    break
            if found:
                self._con.executemany("DELETE FROM messages WHERE id = ?", [(i,) for i in doomed])

    def export_markdown(self, item_id: str, conversation_id: int) -> str | None:
        conversation = self.conversation(item_id, conversation_id)
        if conversation is None:
            return None
        lines = [f"# {conversation['title']}", ""]
        for message in self.messages(conversation_id):
            content = message["content"]
            if message["kind"] == "ask_agent":
                quote = content.get("quote", {})
                lines += [f"> {quote.get('text', '')} (p. {quote.get('page', '?')})", ""]
                lines += [f"**You:** {content.get('question', '')}", ""]
            elif message["role"] == "user":
                notes = "".join(" [image]" for _ in content.get("images") or [])
                lines += [f"**You:** {content.get('text', '')}{notes}", ""]
            elif message["role"] == "assistant":
                lines += [content.get("answer", ""), ""]
        return "\n".join(lines)

    def memory_notes(self, item_id: str) -> list[dict]:
        rows = self._con.execute(
            "SELECT id, text, created_at, source FROM memory_notes WHERE item_id = ? ORDER BY id",
            (item_id,),
        ).fetchall()
        return [{"id": r[0], "text": r[1], "created_at": r[2], "source": r[3]} for r in rows]

    def add_memory_note(
        self, item_id: str, text: str, source: str = "user", limit: int | None = None
    ) -> dict | None:
        """Add a note; with a `limit`, count and insert in one statement (None when full)."""
        now = self._now()
        with self._con:
            cursor = self._con.execute(
                "INSERT INTO memory_notes (item_id, text, created_at, source)"
                " SELECT ?, ?, ?, ? WHERE ? IS NULL"
                " OR (SELECT COUNT(*) FROM memory_notes WHERE item_id = ?) < ?",
                (item_id, text, now, source, limit, item_id, limit),
            )
        if cursor.rowcount == 0:
            return None
        return {"id": int(cursor.lastrowid), "text": text, "created_at": now, "source": source}

    def update_memory_note(self, item_id: str, note_id: int, text: str) -> bool:
        with self._con:
            cursor = self._con.execute(
                "UPDATE memory_notes SET text = ? WHERE id = ? AND item_id = ?",
                (text, note_id, item_id),
            )
        return cursor.rowcount > 0

    def delete_memory_note(self, item_id: str, note_id: int) -> bool:
        with self._con:
            cursor = self._con.execute(
                "DELETE FROM memory_notes WHERE id = ? AND item_id = ?", (note_id, item_id)
            )
        return cursor.rowcount > 0

    def limit_raised(self, conversation_id: int) -> bool:
        row = self._con.execute(
            "SELECT limit_raised FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        return bool(row and row[0])

    def mark_limit_raised(self, conversation_id: int) -> None:
        with self._con:
            self._con.execute(
                "UPDATE conversations SET limit_raised = 1 WHERE id = ?", (conversation_id,)
            )

    def add_trace(
        self,
        conversation_id: int,
        *,
        duration_ms: int,
        tools: list[dict],
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        model: str,
        stopped: bool,
        error_kind: str,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> None:
        """What a turn did (tools, tokens, time), never what was said or read."""
        with self._con:
            self._con.execute(
                "INSERT INTO traces (conversation_id, created_at, duration_ms, tools, input_tokens,"
                " output_tokens, cost_usd, model, stopped, error_kind, cache_read_tokens,"
                " cache_write_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    conversation_id,
                    self._now(),
                    duration_ms,
                    json.dumps(tools),
                    input_tokens,
                    output_tokens,
                    cost_usd,
                    model,
                    int(stopped),
                    error_kind,
                    cache_read_tokens,
                    cache_write_tokens,
                ),
            )

    def session_cost(self, conversation_id: int) -> float:
        """What the conversation cost so far: the traces, which regenerating never deletes."""
        row = self._con.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM traces WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
        return float(row[0])

    def traces(self, conversation_id: int) -> list[dict]:
        rows = self._con.execute(
            "SELECT created_at, duration_ms, tools, input_tokens, output_tokens, cost_usd, model,"
            " stopped, error_kind, cache_read_tokens, cache_write_tokens FROM traces"
            " WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        ).fetchall()
        return [
            {
                "created_at": r[0],
                "duration_ms": r[1],
                "tools": json.loads(r[2]),
                "input_tokens": r[3],
                "output_tokens": r[4],
                "cost_usd": r[5],
                "model": r[6],
                "stopped": bool(r[7]),
                "error_kind": r[8],
                "cache_read_tokens": r[9],
                "cache_write_tokens": r[10],
            }
            for r in rows
        ]

    def paper_text(self, item_id: str) -> dict | None:
        row = self._con.execute(
            "SELECT pages, outline FROM paper_text WHERE item_id = ?", (item_id,)
        ).fetchone()
        return {"pages": json.loads(row[0]), "outline": json.loads(row[1])} if row else None

    def paper_structure(self, item_id: str, extractor: str) -> dict | None:
        """The stored structure of a paper, only if the same version of the extractor made it."""
        row = self._con.execute(
            "SELECT data FROM paper_structure WHERE item_id = ? AND extractor = ?",
            (item_id, extractor),
        ).fetchone()
        return json.loads(row[0]) if row else None

    def save_paper_structure(self, item_id: str, extractor: str, data: dict) -> None:
        with self._con:
            self._con.execute(
                "INSERT OR REPLACE INTO paper_structure (item_id, extractor, data, extracted_at)"
                " VALUES (?, ?, ?, ?)",
                (item_id, extractor, json.dumps(data), self._now()),
            )

    def save_paper_text(
        self, item_id: str, pages: list[str], outline: list[tuple[str, int]]
    ) -> None:
        with self._con:
            self._con.execute(
                "INSERT OR REPLACE INTO paper_text (item_id, pages, outline, extracted_at)"
                " VALUES (?, ?, ?, ?)",
                (item_id, json.dumps(pages), json.dumps(outline), self._now()),
            )

    def add_quiz(self, item_id: str, conversation_id: int | None, spec: dict) -> int:
        """Keep a quiz with its answer on the server side; `spec` is the validated full quiz."""
        with self._con:
            cursor = self._con.execute(
                "INSERT INTO quizzes (item_id, conversation_id, created_at, spec)"
                " VALUES (?, ?, ?, ?)",
                (item_id, conversation_id, self._now(), json.dumps(spec)),
            )
        return int(cursor.lastrowid)

    def quiz(self, item_id: str, quiz_id: int) -> dict | None:
        """The quiz with its private spec and its answer (None while unanswered)."""
        row = self._con.execute(
            "SELECT q.id, q.item_id, q.conversation_id, q.created_at, q.spec,"
            " a.answered_at, a.answer, a.correct, a.reasoning"
            " FROM quizzes q LEFT JOIN quiz_answers a ON a.quiz_id = q.id"
            " WHERE q.id = ? AND q.item_id = ?",
            (quiz_id, item_id),
        ).fetchone()
        if row is None:
            return None
        answered = row[5] is not None
        return {
            "id": row[0],
            "item_id": row[1],
            "conversation_id": row[2],
            "created_at": row[3],
            "spec": json.loads(row[4]),
            "answer": (
                {
                    "answered_at": row[5],
                    "answer": row[6],
                    "correct": bool(row[7]),
                    "reasoning": row[8],
                }
                if answered
                else None
            ),
        }

    def add_quiz_answer(self, quiz_id: int, answer: str, correct: bool, reasoning: str) -> bool:
        """Record the one answer of a quiz; False when it was already answered."""
        try:
            with self._con:
                self._con.execute(
                    "INSERT INTO quiz_answers (quiz_id, answered_at, answer, correct, reasoning)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (quiz_id, self._now(), answer, int(correct), reasoning),
                )
        except sqlite3.IntegrityError:
            return False
        return True

    def quiz_questions(self, item_id: str, limit: int = 10) -> list[str]:
        """The questions of the latest quizzes of a paper, answered or not, newest first."""
        rows = self._con.execute(
            "SELECT spec FROM quizzes WHERE item_id = ? ORDER BY id DESC LIMIT ?", (item_id, limit)
        ).fetchall()
        return [json.loads(r[0])["question"] for r in rows]

    def quiz_history(self, item_id: str) -> list[dict]:
        """Answered quizzes of a paper, newest first (question and verdict, never the key)."""
        rows = self._con.execute(
            "SELECT q.id, q.conversation_id, q.spec, a.answered_at, a.correct"
            " FROM quizzes q JOIN quiz_answers a ON a.quiz_id = q.id"
            " WHERE q.item_id = ? ORDER BY a.answered_at DESC, q.id DESC",
            (item_id,),
        ).fetchall()
        history = []
        for qid, cid, spec, at, correct in rows:
            spec = json.loads(spec)
            history.append(
                {
                    "id": qid,
                    "conversation_id": cid,
                    "question": spec["question"],
                    "kind": spec["kind"],
                    "topic": spec["topic"],
                    "page": spec["page"],
                    "answered_at": at,
                    "correct": bool(correct),
                }
            )
        return history

    def quiz_score(self, item_id: str, conversation_id: int | None = None) -> dict:
        """Answers and right answers for a paper, or for one conversation (a session)."""
        sql = (
            "SELECT COUNT(*), COALESCE(SUM(a.correct), 0) FROM quiz_answers a"
            " JOIN quizzes q ON q.id = a.quiz_id WHERE q.item_id = ?"
        )
        args: list = [item_id]
        if conversation_id is not None:
            sql += " AND q.conversation_id = ?"
            args.append(conversation_id)
        total, correct = self._con.execute(sql, args).fetchone()
        return {"total": int(total), "correct": int(correct)}

    def close(self) -> None:
        self._con.close()

    # --- reports: HTML documents written by the tutor, one row per version -----------------
    def _owns_report(self, item_id: str, report_id: int) -> bool:
        return (
            self._con.execute(
                "SELECT 1 FROM reports WHERE id = ? AND item_id = ?", (report_id, item_id)
            ).fetchone()
            is not None
        )

    def save_report(
        self, item_id: str, title: str, html: str, report_id: int | None = None
    ) -> dict:
        """Add a version (a new report without `report_id`). KeyError for another item's report."""
        if len(html) > MAX_HTML_CHARS:
            raise ValueError(f"a report is {MAX_HTML_CHARS} characters at most")
        now = self._now()
        with self._con:
            if report_id is None:
                report_id = self._con.execute(
                    "INSERT INTO reports (item_id, created_at) VALUES (?, ?)", (item_id, now)
                ).lastrowid
            elif not self._owns_report(item_id, report_id):
                raise KeyError(report_id)
            version = self._con.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM report_versions WHERE report_id = ?",
                (report_id,),
            ).fetchone()[0]
            self._con.execute(
                "INSERT INTO report_versions (report_id, version, title, html, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (report_id, version, title, html, now),
            )
            self._con.execute(
                "DELETE FROM report_versions WHERE report_id = ? AND version <= ?",
                (report_id, version - MAX_VERSIONS),
            )
        return {"id": int(report_id), "version": int(version), "title": title}

    def reports(self, item_id: str) -> list[dict]:
        rows = self._con.execute(
            "SELECT r.id, v.title, v.version, v.created_at FROM reports r JOIN report_versions v"
            " ON v.report_id = r.id AND v.version = (SELECT MAX(version) FROM report_versions"
            " WHERE report_id = r.id) WHERE r.item_id = ? ORDER BY v.created_at DESC, r.id DESC",
            (item_id,),
        ).fetchall()
        return [{"id": r[0], "title": r[1], "version": r[2], "updated_at": r[3]} for r in rows]

    def report(self, item_id: str, report_id: int, version: int | None = None) -> dict | None:
        if not self._owns_report(item_id, report_id):
            return None
        versions = [
            {"version": v, "created_at": c}
            for v, c in self._con.execute(
                "SELECT version, created_at FROM report_versions WHERE report_id = ?"
                " ORDER BY version",
                (report_id,),
            )
        ]
        if not versions:
            return None
        wanted = versions[-1]["version"] if version is None else version
        row = self._con.execute(
            "SELECT title, html FROM report_versions WHERE report_id = ? AND version = ?",
            (report_id, wanted),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": report_id,
            "title": row[0],
            "version": wanted,
            "versions": versions,
            "html": row[1],
        }

    def restore_report(self, item_id: str, report_id: int, version: int) -> dict | None:
        """Copy an old version as the newest one; no version is lost."""
        old = self.report(item_id, report_id, version)
        if old is None:
            return None
        return self.save_report(item_id, old["title"], old["html"], report_id)

    def delete_report(self, item_id: str, report_id: int) -> bool:
        with self._con:
            cursor = self._con.execute(
                "DELETE FROM reports WHERE id = ? AND item_id = ?", (report_id, item_id)
            )
        return cursor.rowcount > 0
