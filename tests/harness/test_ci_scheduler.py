from pathlib import Path

import yaml

CI = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml").read_text()
DOC = yaml.safe_load(CI)
CHECK = DOC["jobs"]["scheduler"]
DEPLOY = DOC["jobs"]["scheduler-deploy"]
SECRET_STEPS = ("make scheduler-deploy", "make tf-init", "make tf-apply-ci")


def test_the_check_job_holds_no_secret_and_validates_terraform():
    assert "secrets." not in str(CHECK)
    runs = [s.get("run", "") for s in CHECK["steps"]]
    assert "make tf-validate" in runs
    # `make check` of the main job already installs and checks the Worker: not done twice
    assert "make scheduler-check" not in runs and "make scheduler-install" not in runs


def test_nothing_is_deployed_unless_every_gate_passed():
    assert set(DEPLOY["needs"]) == {"check", "scheduler"}


def test_a_deploy_in_flight_is_never_cancelled_by_a_newer_push():
    # the workflow-level group would otherwise kill `terraform apply` half way
    assert DOC["concurrency"]["cancel-in-progress"] is False


def test_the_deploy_job_never_runs_two_at_once():
    assert DEPLOY["concurrency"] == {"group": "scheduler-deploy", "cancel-in-progress": False}
    assert DEPLOY["permissions"] == {"contents": "read"}


def test_secrets_reach_only_the_steps_that_use_them_and_after_the_install():
    assert "secrets." not in str(DEPLOY.get("env", {}))
    steps = DEPLOY["steps"]
    install = next(i for i, s in enumerate(steps) if s.get("run") == "make scheduler-install")
    assert "env" not in steps[install]
    for i, step in enumerate(steps):
        has_secret = "secrets." in str(step)
        runs_secret_command = any(cmd in step.get("run", "") for cmd in SECRET_STEPS)
        assert has_secret == runs_secret_command, step
        if has_secret:
            assert i > install


def test_every_secret_the_deploy_needs_is_given():
    text = str(DEPLOY)
    for name in (
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "R2_STATE_ACCESS_KEY_ID",
        "R2_STATE_SECRET_ACCESS_KEY",
    ):
        assert f"secrets.{name}" in text, name
    # the same names as in the secrets and in .env.cloudflare: the Makefile maps them for Terraform
    assert "R2_STATE_ACCESS_KEY_ID: ${{ secrets.R2_STATE_ACCESS_KEY_ID }}" in CI
    assert "R2_STATE_SECRET_ACCESS_KEY: ${{ secrets.R2_STATE_SECRET_ACCESS_KEY }}" in CI
    assert "AWS_" not in text


def test_ci_only_runs_on_push_and_never_on_pull_request_target():
    triggers = set(DOC.get("on", DOC.get(True)))
    assert triggers == {"push"}
    assert "pull_request_target" not in CI
