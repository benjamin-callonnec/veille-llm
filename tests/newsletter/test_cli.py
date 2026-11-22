import sqlite3
from datetime import UTC, datetime

from test_send import Mailer, seeded  # noqa: F401  (sibling test helpers)

from veille_llm.newsletter.cli import main

NOW = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)
ENV = {
    "SUBSCRIBERS": "b@x.org,a@x.org",
    "NEWSLETTER_FROM": "LLM watch <news@x.org>",
    "NEWSLETTER_CONTACT": "me@x.org",
}


def db_with_items(tmp_path):
    path = tmp_path / "v.db"
    disk = sqlite3.connect(path)
    seeded()._conn.backup(disk)
    disk.close()
    return path


def run(tmp_path, argv, env, mailer, capsys):
    code = main(
        ["send", "--db", str(db_with_items(tmp_path)), *argv], env=env, mailer=mailer, now=NOW
    )
    return code, capsys.readouterr().out


def test_masks_every_address_first_on_github_actions_and_never_prints_them_otherwise(
    tmp_path, capsys
):
    mailer = Mailer()
    code, out = run(tmp_path, [], {**ENV, "GITHUB_ACTIONS": "true"}, mailer, capsys)
    lines = out.splitlines()
    assert code == 0 and len(mailer.sent) == 2
    assert lines[0] == "::add-mask::a@x.org" and lines[1] == "::add-mask::b@x.org"
    assert "a@x.org" not in "\n".join(lines[2:]) and "b@x.org" not in "\n".join(lines[2:])
    assert "sent 2" in out


def test_no_mask_lines_outside_github_actions(tmp_path, capsys):
    _, out = run(tmp_path, [], ENV, Mailer(), capsys)
    assert "::add-mask::" not in out and "a@x.org" not in out


def test_exit_code_1_and_no_address_when_delivery_fails(tmp_path, capsys):
    code, out = run(tmp_path, [], {**ENV, "GITHUB_ACTIONS": "true"}, Mailer(fail_at=1), capsys)
    assert code == 1
    assert "recipient #2" in out and "b@x.org" not in out.split("\n", 2)[2]


def test_dry_run_needs_no_smtp_and_writes_files(tmp_path, capsys):
    out_dir = tmp_path / "out"
    env = {"SUBSCRIBERS": "a@x.org"}
    code, out = run(tmp_path, ["--dry-run", "--out", str(out_dir)], env, None, capsys)
    assert code == 0 and (out_dir / "newsletter.html").exists()
    assert "dry run" in out


def test_invalid_subscriber_entries_are_counted_not_printed(tmp_path, capsys):
    env = {**ENV, "SUBSCRIBERS": "a@x.org,garbage-entry"}
    code, out = run(tmp_path, [], env, Mailer(), capsys)
    assert code == 0 and "1 invalid" in out and "garbage-entry" not in out


def test_a_week_without_items_exits_0_and_says_nothing_was_sent(tmp_path, capsys):
    path = tmp_path / "empty.db"
    from veille_llm.store import Store

    Store(path).close()
    mailer = Mailer()
    code = main(["send", "--db", str(path)], env=ENV, mailer=mailer, now=NOW)
    assert code == 0 and mailer.sent == []
    assert "nothing interesting" in capsys.readouterr().out


def test_smtp_login_failure_exits_1_and_prints_only_the_error_type(tmp_path, capsys, monkeypatch):
    import smtplib

    from veille_llm.newsletter import smtp as smtp_module

    class BadLogin:
        def __init__(self, *a, **k):
            pass

        def starttls(self, **k):
            pass

        def login(self, *a):
            raise smtplib.SMTPAuthenticationError(535, b"secret server reply a@x.org")

        def quit(self):
            pass

    monkeypatch.setattr(smtp_module.smtplib, "SMTP", BadLogin)
    env = {**ENV, "SMTP_HOST": "h", "SMTP_PORT": "587", "SMTP_USER": "u", "SMTP_PASSWORD": "pw"}
    code = main(["send", "--db", str(db_with_items(tmp_path))], env=env, now=NOW)
    out = capsys.readouterr().out
    assert code == 1 and "SMTPAuthenticationError" in out
    assert "secret server reply" not in out and "pw" not in out.replace("password", "")


def test_an_already_sent_week_never_opens_an_smtp_connection(tmp_path, capsys, monkeypatch):
    from veille_llm.newsletter import smtp as smtp_module

    opened = []
    monkeypatch.setattr(smtp_module.smtplib, "SMTP", lambda *a, **k: opened.append(1))
    db = db_with_items(tmp_path)
    from veille_llm.store import Store

    store = Store(db)
    store.record_delivery("2026-W48", delivered=2, total=2)
    store.close()
    env = {**ENV, "SMTP_HOST": "h", "SMTP_PORT": "587", "SMTP_USER": "u", "SMTP_PASSWORD": "p"}
    assert main(["send", "--db", str(db)], env=env, now=NOW) == 0
    assert opened == [] and "already sent" in capsys.readouterr().out


def test_week_must_look_like_an_iso_week_and_be_the_current_one_to_send(tmp_path, capsys):
    db = str(db_with_items(tmp_path))
    for bad in ("W40", "2026-40", "2026-W4", "evil\nsubject"):
        assert main(["send", "--db", db, "--week", bad], env=ENV, mailer=Mailer(), now=NOW) == 1
    mailer = Mailer()
    code = main(["send", "--db", db, "--week", "2026-W40"], env=ENV, mailer=mailer, now=NOW)
    assert code == 1 and mailer.sent == [] and "current week" in capsys.readouterr().out


def test_a_past_week_can_still_be_previewed_with_dry_run(tmp_path):
    code = main(
        ["send", "--db", str(db_with_items(tmp_path)), "--week", "2026-W40", "--dry-run",
         "--out", str(tmp_path / "o")],
        env={"SUBSCRIBERS": "a@x.org"}, mailer=None, now=NOW,
    )  # fmt: skip
    assert code == 0


def test_sender_is_required_and_must_be_a_single_plain_address_outside_dry_run(tmp_path, capsys):
    db = str(db_with_items(tmp_path))
    for sender in (None, "a@x.org, b@x.org", "Name <a@x.org>\r\nBcc: z@x.org", "no-address"):
        env = {k: v for k, v in ENV.items() if k != "NEWSLETTER_FROM"}
        if sender:
            env["NEWSLETTER_FROM"] = sender
        mailer = Mailer()
        assert main(["send", "--db", db], env=env, mailer=mailer, now=NOW) == 1
        assert mailer.sent == []
    assert "NEWSLETTER_FROM" in capsys.readouterr().out
