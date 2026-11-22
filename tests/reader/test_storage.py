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


def test_migration_2_keeps_papers_of_a_v1_database(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    con = sqlite3.connect(data / "reader.db")
    con.executescript(MIGRATIONS[0])
    con.execute("INSERT INTO papers VALUES ('a', 'x.pdf', 'now')")
    con.execute("PRAGMA user_version = 1")
    con.commit()
    con.close()
    store = ReaderStore(data)
    assert store.schema_version() == len(MIGRATIONS) >= 2
    assert store.pdf_file("a") == "x.pdf"
    assert store.highlights("a") == []


def test_highlight_round_trip_and_order(tmp_path):
    store = ReaderStore(tmp_path / "data")
    second = store.add_highlight("a", 2, "green", "later", [[0.1, 0.2, 0.3, 0.04]])
    first = store.add_highlight("a", 1, "yellow", "early", [[0, 0, 1, 1]])
    store.add_highlight("b", 1, "red", "other item", [])
    rows = store.highlights("a")
    assert [r["id"] for r in rows] == [first, second]
    assert rows[0]["rects"] == [[0, 0, 1, 1]]
    assert rows[1]["color"] == "green" and rows[1]["text"] == "later" and rows[1]["page"] == 2


def test_delete_highlight_is_scoped_to_its_item(tmp_path):
    store = ReaderStore(tmp_path / "data")
    hid = store.add_highlight("a", 1, "red", "t", [])
    assert store.delete_highlight("b", hid) is False
    assert store.delete_highlight("a", hid) is True
    assert store.delete_highlight("a", hid) is False
    assert store.highlights("a") == []


def test_migration_3_keeps_earlier_tables(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    con = sqlite3.connect(data / "reader.db")
    con.executescript(MIGRATIONS[0] + MIGRATIONS[1])
    con.execute("INSERT INTO papers VALUES ('a', 'x.pdf', 'now')")
    con.execute("PRAGMA user_version = 2")
    con.commit()
    con.close()
    store = ReaderStore(data)
    assert store.schema_version() == len(MIGRATIONS) >= 3
    assert store.pdf_file("a") == "x.pdf"
    assert store.conversations("a") == []


def test_conversations_are_scoped_to_their_item_and_newest_first(tmp_path):
    store = ReaderStore(tmp_path / "data")
    first = store.create_conversation("a", "first")
    second = store.create_conversation("a", "second")
    other = store.create_conversation("b", "other")
    assert [c["title"] for c in store.conversations("a")] == ["second", "first"]
    assert store.conversation("b", first["id"]) is None
    assert store.rename_conversation("b", first["id"], "x") is False
    assert store.rename_conversation("a", first["id"], "renamed") is True
    assert store.conversation("a", first["id"])["title"] == "renamed"
    assert store.delete_conversation("a", other["id"]) is False
    assert store.delete_conversation("a", second["id"]) is True
    assert [c["id"] for c in store.conversations("a")] == [first["id"]]


def test_messages_keep_order_and_content_and_cascade(tmp_path):
    store = ReaderStore(tmp_path / "data")
    conv = store.create_conversation("a", "t")
    one = store.add_message(conv["id"], "user", "text", {"text": "hi"})
    two = store.add_message(conv["id"], "assistant", "assistant", {"answer": "yo", "blocks": []})
    assert [m["seq"] for m in store.messages(conv["id"])] == [1, 2]
    assert store.messages(conv["id"])[1]["content"] == {"answer": "yo", "blocks": []}
    assert one["id"] != two["id"]
    store.delete_conversation("a", conv["id"])
    assert store.messages(conv["id"]) == []


def test_replace_last_assistant_removes_only_a_trailing_assistant_message(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a", "t")["id"]
    store.add_message(cid, "user", "text", {"text": "q"})
    store.replace_last_assistant(cid)
    assert len(store.messages(cid)) == 1
    store.add_message(cid, "assistant", "assistant", {"answer": "a", "blocks": []})
    store.replace_last_assistant(cid)
    assert [m["role"] for m in store.messages(cid)] == ["user"]


def test_export_markdown(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a", "My chat")["id"]
    store.add_message(cid, "user", "text", {"text": "plain question"})
    store.add_message(
        cid,
        "user",
        "ask_agent",
        {"quote": {"text": "a passage", "page": 4, "rects": []}, "question": "why?"},
    )
    store.add_message(
        cid,
        "assistant",
        "assistant",
        {
            "answer": "because [p.4]",
            "blocks": [{"type": "thinking", "text": "SECRET REASONING"}],
            "duration_ms": 10,
            "stopped": False,
        },
    )
    md = store.export_markdown("a", cid)
    assert md.startswith("# My chat")
    assert "plain question" in md and "a passage" in md and "p. 4" in md and "why?" in md
    assert "because [p.4]" in md
    assert "SECRET REASONING" not in md
    assert store.export_markdown("b", cid) is None
