from pathlib import Path

import yaml

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows"
DAILY = (WF / "daily.yml").read_text()
DOC = yaml.safe_load(DAILY)


def triggers(doc):
    return set(doc.get("on", doc.get(True)))


def test_daily_runs_only_on_schedule_and_manually():
    assert triggers(DOC) == {"schedule", "workflow_dispatch"}


def test_oauth_token_is_used_only_by_the_pipeline_step():
    assert DAILY.count("secrets.CLAUDE_CODE_OAUTH_TOKEN") == 1
    step = next(s for s in DOC["jobs"]["core"]["steps"] if "veille-core run" in s.get("run", ""))
    assert "CLAUDE_CODE_OAUTH_TOKEN" in step["env"]
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in str(DOC["jobs"]["deploy"])


def test_only_the_core_job_can_write_contents_and_deploy_has_no_secret():
    assert DOC["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["core"]["permissions"] == {"contents": "write"}
    assert "secrets." not in str(DOC["jobs"]["deploy"]).replace("secrets.GITHUB_TOKEN", "")
    assert DOC["jobs"]["deploy"]["permissions"]["contents"] == "read"


def test_database_is_persisted_even_when_the_run_fails():
    publish = next(s for s in DOC["jobs"]["core"]["steps"] if "persist publish" in s.get("run", ""))
    assert "always()" in publish["if"]


def test_data_branch_writers_share_a_non_cancelling_concurrency_group():
    assert DOC["concurrency"] == {"group": "data-branch", "cancel-in-progress": False}


def test_pages_workflow_no_longer_has_a_schedule():
    assert "schedule" not in triggers(yaml.safe_load((WF / "pages.yml").read_text()))


def test_github_token_is_not_exposed_to_the_llm_step():
    steps = DOC["jobs"]["core"]["steps"]
    llm = next(s for s in steps if "veille-core run" in s.get("run", ""))
    assert "GITHUB_TOKEN" not in str(llm) and "REMOTE" not in str(llm)
    assert "env" not in DOC["jobs"]["core"]
