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


def test_only_the_persist_job_can_write_contents_and_no_job_with_third_party_code_can():
    assert DOC["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["core"]["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["persist"]["permissions"] == {"contents": "write"}
    assert DOC["jobs"]["deploy"]["permissions"]["contents"] == "read"
    assert "secrets." not in str(DOC["jobs"]["deploy"])
    assert "uv " not in str(DOC["jobs"]["persist"])  # persist runs plain python, no deps


def test_database_is_persisted_even_when_the_run_fails():
    assert "always()" in DOC["jobs"]["persist"]["if"]
    assert DOC["jobs"]["persist"]["needs"] == "core"


def test_core_runs_only_from_main():
    assert "refs/heads/main" in DOC["jobs"]["core"]["if"]


def test_deploy_fails_rather_than_shipping_without_a_catalogue():
    download = next(
        s for s in DOC["jobs"]["deploy"]["steps"] if "download-artifact" in s.get("uses", "")
    )
    assert "continue-on-error" not in download


def test_pages_has_a_single_deployer():
    assert not (WF / "pages.yml").exists()
    assert DOC["jobs"]["deploy"]["concurrency"]["group"] == "pages"


def test_data_branch_writers_share_a_non_cancelling_concurrency_group():
    assert DOC["concurrency"] == {"group": "data-branch", "cancel-in-progress": False}
