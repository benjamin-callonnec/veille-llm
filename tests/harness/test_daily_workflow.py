from pathlib import Path

import yaml

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows"
DAILY = (WF / "daily.yml").read_text()
DOC = yaml.safe_load(DAILY)


def triggers(doc):
    return set(doc.get("on", doc.get(True)))


def test_daily_runs_only_when_dispatched_by_the_cloudflare_worker_or_by_hand():
    # GitHub's own cron starts hours late: the Worker `veille-llm-scheduler` dispatches it (#38)
    assert triggers(DOC) == {"workflow_dispatch"}
    assert "schedule:" not in DAILY and "cron:" not in DAILY


def test_oauth_token_is_used_only_by_the_pipeline_step():
    assert DAILY.count("secrets.CLAUDE_CODE_OAUTH_TOKEN") == 1
    step = next(s for s in DOC["jobs"]["core"]["steps"] if "veille-core run" in s.get("run", ""))
    assert "CLAUDE_CODE_OAUTH_TOKEN" in step["env"]
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in str(DOC["jobs"]["deploy"])


def test_only_the_persist_job_can_write_contents_and_no_job_with_third_party_code_can():
    assert DOC["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["core"]["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["persist"]["permissions"] == {"contents": "write"}
    assert "secrets." not in str(DOC["jobs"]["deploy"]) + str(DOC["jobs"]["build-web"])
    assert "uv " not in str(DOC["jobs"]["persist"])  # persist runs plain python, no deps


def test_database_is_persisted_even_when_the_run_fails():
    assert "always()" in DOC["jobs"]["persist"]["if"]
    assert DOC["jobs"]["persist"]["needs"] == "core"


def test_core_runs_only_from_main():
    assert "refs/heads/main" in DOC["jobs"]["core"]["if"]


def test_pages_has_a_single_deployer():
    assert not (WF / "pages.yml").exists()
    assert DOC["jobs"]["deploy"]["concurrency"]["group"] == "pages"


def test_data_branch_writers_share_a_non_cancelling_concurrency_group():
    assert DOC["concurrency"] == {"group": "data-branch", "cancel-in-progress": False}


def test_web_is_built_without_install_scripts_in_a_job_with_no_pages_token():
    job = DOC["jobs"]["build-web"]
    assert job["permissions"] == {"contents": "read"}
    runs = [s.get("run") for s in job["steps"]]
    assert "npm ci --ignore-scripts" in runs and "npm run build" in runs
    download = next(s for s in job["steps"] if "download-artifact" in s.get("uses", ""))
    assert download["with"]["path"] == "web/dist"
    assert "continue-on-error" not in download  # no catalogue: fail, keep the live site
    upload = next(s for s in job["steps"] if "upload-pages-artifact" in s.get("uses", ""))
    assert upload["with"]["path"] == "web/dist"


def test_deploy_job_only_publishes_and_never_runs_third_party_code():
    job = DOC["jobs"]["deploy"]
    assert job["permissions"] == {"pages": "write", "id-token": "write"}
    assert all("run" not in s for s in job["steps"])
    assert [s["uses"] for s in job["steps"]] == ["actions/deploy-pages@v4"]
