from pathlib import Path

CI = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml").read_text()


def test_ci_scans_full_history_with_gitleaks():
    # The pre-commit gitleaks hook only scans staged files, so CI needs its own scan.
    assert "gitleaks/gitleaks-action" in CI
    assert "fetch-depth: 0" in CI


def test_ci_has_a_timeout_and_read_only_permissions():
    assert "timeout-minutes:" in CI
    assert "contents: read" in CI


def test_ci_runs_only_on_push_to_main():
    # Gitflow: work happens on develop (no CI), CI runs when main is pushed.
    assert "push:" in CI
    assert "branches: [main]" in CI
    assert "pull_request" not in CI
    assert "develop" not in CI
