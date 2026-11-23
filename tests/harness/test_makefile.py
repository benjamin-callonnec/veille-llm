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
