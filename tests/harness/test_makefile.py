import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _recipe(target: str) -> str:
    text = (ROOT / "Makefile").read_text()
    match = re.search(rf"^{target}:.*\n((?:\t.*\n?)*)", text, re.MULTILINE)
    assert match, f"target {target} not found"
    return match.group(1)


def test_check_target_runs_lint_format_and_tests():
    recipe = _recipe("check")
    assert "ruff check" in recipe
    assert "ruff format --check" in recipe
    assert "pytest" in recipe
    assert "--fix" not in recipe


def test_gitignore_blocks_private_files():
    lines = (ROOT / ".gitignore").read_text().splitlines()
    assert "subscribers.txt" in lines
    assert ".env" in lines
    assert ".env.*" in lines
    assert "!.env.example" in lines


def test_subs_add_and_remove_explain_the_email_variable_when_it_is_missing():
    import subprocess

    for target in ("subs-add", "subs-remove"):
        result = subprocess.run(
            ["make", "-s", target, "someone@example.org"],  # a common mistake: no EMAIL=
            cwd=ROOT, capture_output=True, text=True,
        )  # fmt: skip
        assert result.returncode != 0
        assert f"usage: make {target} EMAIL=" in result.stdout + result.stderr


def test_reader_ports_are_variables_shared_by_the_check_and_the_commands():
    text = (ROOT / "Makefile").read_text()
    assert "READER_PORT ?= 8765" in text
    assert "FRONT_PORT ?= 5173" in text
    assert "READER_FRONT_URL ?= http://127.0.0.1:$(FRONT_PORT)" in text
    recipe = _recipe("reader")
    assert "for port in $(READER_PORT) $(FRONT_PORT)" in recipe
    assert "--port $(FRONT_PORT)" in recipe
    assert "8765" not in recipe and "5173" not in recipe


def test_scheduler_targets_install_without_scripts_and_set_the_github_secret():
    assert "npm ci" in _recipe("scheduler-install")
    assert "--ignore-scripts" in _recipe("scheduler-install")
    assert "wrangler secret put GITHUB_TOKEN" in _recipe("scheduler-secret")
    assert "wrangler deploy" in _recipe("scheduler-deploy")
    assert "npm run check" in _recipe("scheduler-check")


def test_install_and_check_cover_the_scheduler():
    assert "scheduler-install" in _recipe("install")
    assert "scheduler-check" in _recipe("check")


def test_wrangler_leaves_the_crons_to_terraform():
    wrangler = (ROOT / "scheduler" / "wrangler.toml").read_text()
    assert 'name = "veille-llm-scheduler"' in wrangler
    assert "workers_dev = false" in wrangler
    assert "[triggers]" not in wrangler.replace("# [triggers]", "")
    assert not any(line.strip().startswith("crons") for line in wrangler.splitlines()), (
        "the crons are Terraform's (iac/main.tf)"
    )


def test_gitignore_blocks_scheduler_and_terraform_local_files():
    lines = (ROOT / ".gitignore").read_text().splitlines()
    for wanted in (
        "scheduler/node_modules/",
        ".wrangler/",
        ".dev.vars",
        "iac/.terraform/",
        "*.tfstate*",
    ):
        assert wanted in lines, wanted


def test_terraform_targets():
    assert "-backend=false" in _recipe("tf-validate")
    assert "validate" in _recipe("tf-validate")
    assert "fmt -check" in _recipe("tf-validate")
    assert "-backend-config" in _recipe("tf-init")
    assert "-auto-approve" in _recipe("tf-apply-ci")
    assert "-auto-approve" not in _recipe("tf-apply")


def test_terraform_targets_stop_early_when_the_environment_is_incomplete():
    makefile = (ROOT / "Makefile").read_text()
    for target in ("tf-init", "tf-plan", "tf-apply", "tf-apply-ci"):
        assert re.search(rf"^{target}:.*\btf-env\b", makefile, re.MULTILINE), target
    recipe = _recipe("tf-env")
    for name in (
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ):
        assert name in recipe, name
    assert "is not set" in recipe and "setup/README.md" in recipe
    assert "tf-env" not in re.search(r"^tf-validate:.*", makefile, re.MULTILINE).group(0)
