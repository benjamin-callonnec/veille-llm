from pathlib import Path

import yaml

WORKFLOW = (
    Path(__file__).resolve().parents[2] / ".github" / "workflows" / "freshness.yml"
).read_text()
DOC = yaml.safe_load(WORKFLOW)


def test_freshness_runs_on_schedule_and_manually_only():
    assert set(DOC.get("on", DOC.get(True))) == {"schedule", "workflow_dispatch"}


def test_it_only_reads_runs_and_holds_no_secret():
    assert DOC["permissions"] == {"actions": "read", "contents": "read"}
    assert "secrets." not in WORKFLOW.replace("github.token", "")
    assert "pull_request" not in WORKFLOW


def test_it_watches_daily_within_30_hours_and_weekly_within_8_days():
    matrix = DOC["jobs"]["check"]["strategy"]["matrix"]["include"]
    assert {(m["workflow"], m["hours"]) for m in matrix} == {("daily", 30), ("weekly", 192)}


def test_it_asks_for_the_latest_successful_run_and_checks_its_age():
    assert "--workflow ${{ matrix.workflow }}.yml" in WORKFLOW
    assert "--status success" in WORKFLOW
    assert "PYTHONPATH=src python3 -m veille_llm.freshness" in WORKFLOW
