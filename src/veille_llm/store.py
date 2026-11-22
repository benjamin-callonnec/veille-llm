"""SQLite store. Every state change is committed per batch so a run can resume."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import astuple
from datetime import datetime, timedelta
from pathlib import Path

from veille_llm.models import LEGACY, Enrichment, Item, Provenance, Verdict, content_hash
from veille_llm.pipeline.version import outdated

_SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    url TEXT NOT NULL,
    authors TEXT NOT NULL,
    published TEXT NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS verdicts (
    item_id TEXT PRIMARY KEY REFERENCES items(id),
    interesting INTEGER NOT NULL,
    score INTEGER NOT NULL,
    type TEXT NOT NULL,
    category_hint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrichments (
    item_id TEXT PRIMARY KEY REFERENCES items(id),
    category TEXT NOT NULL,
    hook TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY);
-- Weekly newsletter progress: counts only, this database is public (never addresses).
CREATE TABLE IF NOT EXISTS newsletter (
    week TEXT PRIMARY KEY,
    delivered INTEGER NOT NULL,
    total INTEGER NOT NULL
);
"""

_ITEM_COLUMNS = "id, source, kind, title, summary, url, authors, published, upvotes"


def _item(row: sqlite3.Row | tuple) -> Item:
    return Item(
        id=row[0],
        source=row[1],
        kind=row[2],
        title=row[3],
        summary=row[4],
        url=row[5],
        authors=json.loads(row[6]),
        published=row[7],
        upvotes=row[8],
    )


def _parse(timestamp: str) -> datetime:
    return datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")


class Store:
    def __init__(self, path: str | Path) -> None:
        self._conn = sqlite3.connect(str(path))
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(_SCHEMA)
        self._migrate_columns()
        with self._conn:  # the fallback category used to be French
            self._conn.execute(
                "UPDATE enrichments SET category = 'Other' WHERE category = 'Autres'"
            )
            if self._conn.execute("SELECT 1 FROM categories WHERE name = 'Autres'").fetchone():
                self._conn.execute("INSERT OR IGNORE INTO categories VALUES ('Other')")
                self._conn.execute("DELETE FROM categories WHERE name = 'Autres'")

    def _migrate_columns(self) -> None:
        """Columns added after the first databases were published; old rows get safe defaults."""

        def columns(table: str) -> list[str]:
            return [r[1] for r in self._conn.execute(f"PRAGMA table_info({table})")]

        legacy = "TEXT NOT NULL DEFAULT 'legacy'"
        wanted = {
            "enrichments": [("brief", "TEXT NOT NULL DEFAULT ''")],
            "items": [("content_hash", "TEXT NOT NULL DEFAULT ''")],
        }
        for table in ("verdicts", "enrichments"):
            wanted.setdefault(table, [])
            wanted[table] += [("model", legacy), ("prompt", legacy), ("pipeline", legacy)]
        for table, additions in wanted.items():
            present = columns(table)
            for name, ddl in additions:
                if name not in present:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        # Backfill the dedupe hash of items stored before it existed.
        todo = self._conn.execute("SELECT id, title FROM items WHERE content_hash = ''").fetchall()
        with self._conn:
            for item_id, title in todo:
                digest = content_hash(title)
                if digest:
                    self._conn.execute(
                        "UPDATE items SET content_hash = ? WHERE id = ?", (digest, item_id)
                    )

    def close(self) -> None:
        self._conn.close()

    def known_ids(self, ids: list[str]) -> set[str]:
        if not ids:
            return set()
        marks = ",".join("?" * len(ids))
        rows = self._conn.execute(f"SELECT id FROM items WHERE id IN ({marks})", ids)
        return {row[0] for row in rows}

    def upsert_items(self, items: list[Item], now: str) -> int:
        existing = self.known_ids([i.id for i in items])
        with self._conn:
            for i in items:
                digest = content_hash(i.title)
                status = "new"
                if i.id not in existing and digest:
                    # Same article under another id (arXiv and Hugging Face, a re-published
                    # post): the first one wins, the copy is never sent to the LLM.
                    twin = self._conn.execute(
                        "SELECT 1 FROM items WHERE content_hash = ? AND id != ? "
                        "AND status != 'duplicate' LIMIT 1",
                        (digest, i.id),
                    ).fetchone()
                    if twin:
                        status = "duplicate"
                self._conn.execute(
                    "INSERT INTO items (id, source, kind, title, summary, url, authors, "
                    "published, upvotes, first_seen, status, content_hash) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(id) DO UPDATE SET upvotes = MAX(upvotes, excluded.upvotes)",
                    (
                        i.id,
                        i.source,
                        i.kind,
                        i.title,
                        i.summary,
                        i.url,
                        json.dumps(i.authors),
                        i.published,
                        i.upvotes,
                        now,
                        status,
                        digest,
                    ),
                )
        return len({i.id for i in items} - existing)

    def refresh_upvotes(self, upvotes: dict[str, int]) -> None:
        """Raise (never lower) the upvotes of known items, whatever their status."""
        with self._conn:
            for item_id, votes in upvotes.items():
                self._conn.execute(
                    "UPDATE items SET upvotes = MAX(upvotes, ?) WHERE id = ?", (votes, item_id)
                )

    def pending_classification(self, limit: int | None = None) -> list[Item]:
        sql = f"SELECT {_ITEM_COLUMNS} FROM items WHERE status = 'new' ORDER BY published DESC"
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        return [_item(row) for row in self._conn.execute(sql)]

    def save_verdicts(self, verdicts: list[Verdict], provenance: Provenance = LEGACY) -> None:
        with self._conn:
            for v in verdicts:
                self._conn.execute(
                    "INSERT OR REPLACE INTO verdicts (item_id, interesting, score, type, "
                    "category_hint, model, prompt, pipeline) VALUES (?,?,?,?,?,?,?,?)",
                    (
                        v.item_id,
                        int(v.interesting),
                        v.score,
                        v.type,
                        v.category_hint,
                        provenance.model,
                        provenance.prompt,
                        provenance.pipeline,
                    ),
                )
                self._conn.execute(
                    "UPDATE items SET status = ? WHERE id = ?",
                    ("interesting" if v.interesting else "rejected", v.item_id),
                )

    def pending_enrichment(self, limit: int | None = None) -> list[tuple[Item, Verdict]]:
        sql = (
            f"SELECT {', '.join('i.' + c.strip() for c in _ITEM_COLUMNS.split(','))}, "
            "v.interesting, v.score, v.type, v.category_hint "
            "FROM items i JOIN verdicts v ON v.item_id = i.id "
            "WHERE i.status = 'interesting' ORDER BY i.published DESC"
        )
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        out = []
        for row in self._conn.execute(sql):
            item = _item(row[:9])
            out.append((item, Verdict(item.id, bool(row[9]), row[10], row[11], row[12])))
        return out

    def save_enrichments(
        self, enrichments: list[Enrichment], provenance: Provenance = LEGACY
    ) -> None:
        with self._conn:
            for e in enrichments:
                self._conn.execute("INSERT OR IGNORE INTO categories VALUES (?)", (e.category,))
                self._conn.execute(
                    "INSERT OR REPLACE INTO enrichments (item_id, category, hook, brief, "
                    "model, prompt, pipeline) VALUES (?,?,?,?,?,?,?)",
                    (
                        e.item_id,
                        e.category,
                        e.hook,
                        e.brief,
                        provenance.model,
                        provenance.prompt,
                        provenance.pipeline,
                    ),
                )
                self._conn.execute(
                    "UPDATE items SET status = 'published' WHERE id = ?", (e.item_id,)
                )

    def stale_classification(self, current: Provenance, limit: int) -> list[Item]:
        """Classified items whose verdict was made under another model, prompt or minor version."""
        rows = self._conn.execute(
            f"SELECT {', '.join('i.' + c.strip() for c in _ITEM_COLUMNS.split(','))}, "
            "v.model, v.prompt, v.pipeline FROM items i JOIN verdicts v ON v.item_id = i.id "
            "WHERE i.status IN ('published', 'interesting', 'rejected') "
            "ORDER BY i.published DESC, i.id"
        )
        out = []
        for row in rows:
            if outdated(Provenance(row[9], row[10], row[11]), current):
                out.append(_item(row[:9]))
                if len(out) >= limit:
                    break
        return out

    def stale_hooks(
        self, current: Provenance, limit: int
    ) -> list[tuple[Item, Verdict, Enrichment]]:
        """Published items whose hook and brief were written under another version."""
        rows = self._conn.execute(
            f"SELECT {', '.join('i.' + c.strip() for c in _ITEM_COLUMNS.split(','))}, "
            "v.interesting, v.score, v.type, v.category_hint, "
            "e.category, e.hook, e.brief, e.model, e.prompt, e.pipeline "
            "FROM items i JOIN verdicts v ON v.item_id = i.id "
            "JOIN enrichments e ON e.item_id = i.id "
            "WHERE i.status = 'published' ORDER BY i.published DESC, i.id"
        )
        out = []
        for row in rows:
            if outdated(Provenance(row[16], row[17], row[18]), current):
                item = _item(row[:9])
                verdict = Verdict(item.id, bool(row[9]), row[10], row[11], row[12])
                out.append((item, verdict, Enrichment(item.id, row[13], row[14], row[15])))
                if len(out) >= limit:
                    break
        return out

    def refresh_verdict(self, v: Verdict, provenance: Provenance) -> None:
        """Replace a verdict with a newer one. A published item is never unpublished."""
        status = self._conn.execute(
            "SELECT status FROM items WHERE id = ?", (v.item_id,)
        ).fetchone()
        if status is None:
            return
        with self._conn:
            if status[0] == "published":
                self._conn.execute(
                    "UPDATE verdicts SET score = ?, type = ?, category_hint = ?, model = ?, "
                    "prompt = ?, pipeline = ? WHERE item_id = ?",
                    (v.score, v.type, v.category_hint, *astuple(provenance), v.item_id),
                )
                return
            self._conn.execute(
                "UPDATE verdicts SET interesting = ?, score = ?, type = ?, category_hint = ?, "
                "model = ?, prompt = ?, pipeline = ? WHERE item_id = ?",
                (
                    int(v.interesting),
                    v.score,
                    v.type,
                    v.category_hint,
                    *astuple(provenance),
                    v.item_id,
                ),
            )
            self._conn.execute(
                "UPDATE items SET status = ? WHERE id = ?",
                ("interesting" if v.interesting else "rejected", v.item_id),
            )

    def refresh_enrichment(
        self, item_id: str, hook: str, brief: str, provenance: Provenance
    ) -> None:
        """New hook and brief; the category stays (consolidation may have chosen it)."""
        with self._conn:
            self._conn.execute(
                "UPDATE enrichments SET hook = ?, brief = ?, model = ?, prompt = ?, pipeline = ? "
                "WHERE item_id = ?",
                (hook, brief, *astuple(provenance), item_id),
            )

    def newsletter_progress(self, week: str) -> tuple[int, int] | None:
        row = self._conn.execute(
            "SELECT delivered, total FROM newsletter WHERE week = ?", (week,)
        ).fetchone()
        return (row[0], row[1]) if row else None

    def record_delivery(self, week: str, *, delivered: int, total: int) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO newsletter (week, delivered, total) VALUES (?,?,?) "
                "ON CONFLICT(week) DO UPDATE SET delivered = excluded.delivered, "
                "total = excluded.total",
                (week, delivered, total),
            )

    def category_usage(self, since: str) -> list[tuple[str, int]]:
        """Categories of the published items inside the window, most used first."""
        rows = self._conn.execute(
            "SELECT e.category, COUNT(*) FROM enrichments e JOIN items i ON i.id = e.item_id "
            "WHERE i.status = 'published' AND i.published >= ? "
            "GROUP BY e.category ORDER BY COUNT(*) DESC, e.category",
            (since,),
        )
        return [(row[0], row[1]) for row in rows]

    def rename_category(self, old: str, new: str) -> int:
        with self._conn:
            self._conn.execute("INSERT OR IGNORE INTO categories VALUES (?)", (new,))
            cursor = self._conn.execute(
                "UPDATE enrichments SET category = ? WHERE category = ?", (new, old)
            )
        return cursor.rowcount

    def reassign_other(self, item_id: str, category: str) -> bool:
        with self._conn:
            self._conn.execute("INSERT OR IGNORE INTO categories VALUES (?)", (category,))
            cursor = self._conn.execute(
                "UPDATE enrichments SET category = ? WHERE item_id = ? AND category = 'Other'",
                (category, item_id),
            )
        return cursor.rowcount == 1

    def other_items(self, since: str, limit: int = 60) -> list[dict]:
        rows = self._conn.execute(
            "SELECT i.id, i.title, e.hook FROM enrichments e JOIN items i ON i.id = e.item_id "
            "WHERE i.status = 'published' AND i.published >= ? AND e.category = 'Other' "
            "ORDER BY i.published DESC, i.id LIMIT ?",
            (since, limit),
        )
        return [{"id": r[0], "title": r[1], "hook": r[2]} for r in rows]

    def category_names(self) -> list[str]:
        return [row[0] for row in self._conn.execute("SELECT name FROM categories ORDER BY rowid")]

    def abandon_stale(self, now: str, max_age_days: int = 3) -> int:
        cutoff = (_parse(now) - timedelta(days=max_age_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._conn:
            cursor = self._conn.execute(
                "UPDATE items SET status = 'abandoned' "
                "WHERE status IN ('new', 'interesting') AND first_seen < ?",
                (cutoff,),
            )
        return cursor.rowcount

    def published_items(self, since: str) -> list[dict]:
        rows = self._conn.execute(
            f"SELECT {', '.join('i.' + c.strip() for c in _ITEM_COLUMNS.split(','))}, "
            "v.score, v.type, e.category, e.hook, e.brief FROM items i "
            "JOIN verdicts v ON v.item_id = i.id JOIN enrichments e ON e.item_id = i.id "
            "WHERE i.status = 'published' AND i.published >= ? ORDER BY i.published DESC",
            (since,),
        )
        out = []
        for row in rows:
            item = _item(row[:9])
            out.append(
                {
                    "id": item.id,
                    "source": item.source,
                    "kind": item.kind,
                    "title": item.title,
                    "url": item.url,
                    "authors": item.authors,
                    "published": item.published,
                    "upvotes": item.upvotes,
                    "score": row[9],
                    "type": row[10],
                    "category": row[11],
                    "hook": row[12],
                    "brief": row[13],
                }
            )
        return out
