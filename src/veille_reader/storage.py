"""Local storage of the reader: one SQLite file and a PDF cache, all under one data dir."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

MIGRATIONS: list[str] = [
    """
    CREATE TABLE papers (
        item_id TEXT PRIMARY KEY,
        pdf_file TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    """,
]


class StorageError(Exception):
    pass


class ReaderStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.pdfs_dir = data_dir / "pdfs"
        self.pdfs_dir.mkdir(parents=True, exist_ok=True)
        self._con = sqlite3.connect(data_dir / "reader.db", check_same_thread=False)
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

    def close(self) -> None:
        self._con.close()
