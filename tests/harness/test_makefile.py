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
