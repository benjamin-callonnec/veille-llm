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


def test_the_store_can_be_used_from_several_threads_at_once(tmp_path):
    import threading

    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    errors: list[Exception] = []

    def writer(n):
        try:
            for i in range(300):
                store.add_memory_note("a1", f"w{n}-{i}")
                store.memory_notes("a1")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for i in range(300):
        store.add_message(cid, "user", "text", {"text": str(i)})
        store.messages(cid)
    for t in threads:
        t.join()
    assert errors == []
    assert len(store.memory_notes("a1")) == 1200
    assert len(store.messages(cid)) == 300


def test_a_note_is_added_only_below_the_limit_in_one_step(tmp_path):
    store = ReaderStore(tmp_path / "data")
    for i in range(3):
        assert store.add_memory_note("a1", f"n{i}", limit=3) is not None
    assert store.add_memory_note("a1", "one too many", limit=3) is None
    assert store.add_memory_note("b1", "other paper", limit=3) is not None
    assert len(store.memory_notes("a1")) == 3


def test_the_trace_keeps_the_cache_tokens(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    store.add_trace(
        cid, duration_ms=5, tools=[], input_tokens=1, output_tokens=2, cost_usd=0.1, model="m",
        stopped=False, error_kind="", cache_read_tokens=30, cache_write_tokens=40,
    )  # fmt: skip
    store.add_trace(
        cid, duration_ms=5, tools=[], input_tokens=1, output_tokens=2, cost_usd=0.1, model="m",
        stopped=False, error_kind="",
    )  # fmt: skip
    first, second = store.traces(cid)
    assert (first["cache_read_tokens"], first["cache_write_tokens"]) == (30, 40)
    assert (second["cache_read_tokens"], second["cache_write_tokens"]) == (0, 0)


def test_a_message_can_be_updated_and_messages_deleted(tmp_path):
    store = ReaderStore(tmp_path / "data")
    cid = store.create_conversation("a1", "t")["id"]
    first = store.add_message(cid, "user", "text", {"text": "a"})
    second = store.add_message(cid, "system", "ask", {"status": "pending"})
    store.update_message_content(second["id"], {"status": "answered"})
    assert store.messages(cid)[1]["content"] == {"status": "answered"}
    store.delete_messages(cid, [first["id"], second["id"]])
    assert store.messages(cid) == []
