"""SQLite store. Every state change is committed per batch so a run can resume."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from veille_llm.models import Enrichment, Item, Verdict

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
        columns = [r[1] for r in self._conn.execute("PRAGMA table_info(enrichments)")]
        if "brief" not in columns:  # database created before briefs existed
            self._conn.execute("ALTER TABLE enrichments ADD COLUMN brief TEXT NOT NULL DEFAULT ''")

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
                self._conn.execute(
                    "INSERT INTO items (id, source, kind, title, summary, url, authors, "
                    "published, upvotes, first_seen) VALUES (?,?,?,?,?,?,?,?,?,?) "
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

    def save_verdicts(self, verdicts: list[Verdict]) -> None:
        with self._conn:
            for v in verdicts:
                self._conn.execute(
                    "INSERT OR REPLACE INTO verdicts VALUES (?,?,?,?,?)",
                    (v.item_id, int(v.interesting), v.score, v.type, v.category_hint),
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

    def save_enrichments(self, enrichments: list[Enrichment]) -> None:
        with self._conn:
            for e in enrichments:
                self._conn.execute("INSERT OR IGNORE INTO categories VALUES (?)", (e.category,))
                self._conn.execute(
                    "INSERT OR REPLACE INTO enrichments (item_id, category, hook, brief) "
                    "VALUES (?,?,?,?)",
                    (e.item_id, e.category, e.hook, e.brief),
                )
                self._conn.execute(
                    "UPDATE items SET status = 'published' WHERE id = ?", (e.item_id,)
                )

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
