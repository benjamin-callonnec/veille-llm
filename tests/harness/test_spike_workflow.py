from pathlib import Path

WORKFLOW = (
    Path(__file__).resolve().parents[2] / ".github" / "workflows" / "spike-llm.yml"
).read_text()


def test_spike_workflow_is_manual_and_has_no_api_key():
    assert "workflow_dispatch" in WORKFLOW
    assert "CLAUDE_CODE_OAUTH_TOKEN" in WORKFLOW
    assert "timeout-minutes" in WORKFLOW
    assert "contents: read" in WORKFLOW
    for forbidden in ("ANTHROPIC_API_KEY", "pull_request", "schedule", "pull_request_target"):
        assert forbidden not in WORKFLOW, forbidden


def test_spike_runs_only_from_main_because_it_holds_the_oauth_token():
    # the Worker's GitHub token can dispatch any workflow on any branch: guard it like daily/weekly
    assert "github.ref == 'refs/heads/main'" in WORKFLOW
