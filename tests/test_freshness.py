import io
import json
from datetime import UTC, datetime, timedelta

import pytest

from veille_llm import freshness
from veille_llm.freshness import check, main

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)


def run_at(hours_ago: float) -> dict:
    return {"createdAt": (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")}


def test_a_recent_successful_run_is_fresh():
    fresh, message = check([run_at(3)], NOW, 30)
    assert fresh is True
    assert "3.0 hours" in message


def test_an_old_successful_run_is_stale():
    fresh, message = check([run_at(31)], NOW, 30)
    assert fresh is False
    assert "31.0 hours" in message


def test_no_run_at_all_is_stale():
    assert check([], NOW, 30) == (False, "no successful run found")


def test_only_the_latest_run_counts():
    assert check([run_at(2), run_at(100)], NOW, 30)[0] is True


@pytest.mark.parametrize(
    "raw", ["{", "[]", '[{"createdAt": "not a date"}]', '[{"nope": 1}]', '"x"']
)
def test_unreadable_input_is_stale_not_a_crash(monkeypatch, capsys, raw):
    monkeypatch.setattr(freshness.sys, "stdin", io.StringIO(raw))
    assert main([]) == 1
    assert capsys.readouterr().out.strip()  # says why


def test_main_reads_runs_on_stdin_and_answers_by_exit_code(monkeypatch):
    runs = json.dumps([run_at(3)])
    monkeypatch.setattr(freshness, "_now", lambda: NOW)
    monkeypatch.setattr(freshness.sys, "stdin", io.StringIO(runs))
    assert main([]) == 0
    monkeypatch.setattr(freshness.sys, "stdin", io.StringIO(runs))
    assert main(["--max-hours", "2"]) == 1
