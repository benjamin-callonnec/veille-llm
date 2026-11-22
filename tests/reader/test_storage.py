import sqlite3

import pytest

from veille_reader.storage import MIGRATIONS, ReaderStore, StorageError


def test_fresh_dir_is_migrated_to_latest(tmp_path):
    store = ReaderStore(tmp_path / "data")
    assert store.schema_version() == len(MIGRATIONS)
    assert store.pdfs_dir.is_dir()


def test_reopen_does_not_rerun_migrations(tmp_path):
    store = ReaderStore(tmp_path / "data")
    store.record_pdf("a", "2401.01234.pdf")
    store.close()
    again = ReaderStore(tmp_path / "data")
    assert again.pdf_file("a") == "2401.01234.pdf"


def test_newer_database_is_refused(tmp_path):
    data = tmp_path / "data"
    ReaderStore(data).close()
    con = sqlite3.connect(data / "reader.db")
    con.execute("PRAGMA user_version = 99")
    con.commit()
    con.close()
    with pytest.raises(StorageError):
        ReaderStore(data)


def test_record_and_read_pdf_file(tmp_path):
    store = ReaderStore(tmp_path / "data")
    assert store.pdf_file("a") is None
    store.record_pdf("a", "x.pdf")
    store.record_pdf("a", "y.pdf")
    assert store.pdf_file("a") == "y.pdf"


def test_nothing_written_outside_data_dir(tmp_path):
    ReaderStore(tmp_path / "data").close()
    assert [p.name for p in tmp_path.iterdir()] == ["data"]
