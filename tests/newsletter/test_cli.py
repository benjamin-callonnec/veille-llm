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
