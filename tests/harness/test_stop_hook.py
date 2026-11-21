import json
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / ".claude" / "hooks" / "stop-checks.sh"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q")
    (r / "app.py").write_text("x = 1\n")
    _git(r, "add", ".")
    _git(r, "commit", "-q", "-m", "init")
    return r


def _fake_make(tmp_path: Path, exit_code: int, message: str = "") -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    marker = tmp_path / "make-called"
    make = bin_dir / "make"
    make.write_text(f"#!/bin/sh\ntouch '{marker}'\necho '{message}'\nexit {exit_code}\n")
    make.chmod(0o755)
    return bin_dir


def _run(repo: Path, bin_dir: Path, payload: dict | None = None):
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "CLAUDE_PROJECT_DIR": str(repo)}
    return subprocess.run(
        [str(SCRIPT)],
        input=json.dumps(payload or {}),
        text=True,
        capture_output=True,
        cwd=repo,
        env=env,
    )


def test_exits_0_when_no_python_changed(repo, tmp_path):
    bin_dir = _fake_make(tmp_path, 1, "LINT ERROR")
    result = _run(repo, bin_dir)
    assert result.returncode == 0
    assert not (tmp_path / "make-called").exists()


def test_exits_0_when_make_check_passes(repo, tmp_path):
    (repo / "app.py").write_text("x = 2\n")
    result = _run(repo, _fake_make(tmp_path, 0))
    assert result.returncode == 0
    assert (tmp_path / "make-called").exists()


def test_exits_2_with_output_when_make_check_fails(repo, tmp_path):
    (repo / "app.py").write_text("x = 2\n")
    result = _run(repo, _fake_make(tmp_path, 1, "LINT ERROR"))
    assert result.returncode == 2
    assert "LINT ERROR" in result.stderr


def test_does_not_block_when_stop_hook_active(repo, tmp_path):
    (repo / "app.py").write_text("x = 2\n")
    result = _run(repo, _fake_make(tmp_path, 1, "LINT ERROR"), {"stop_hook_active": True})
    assert result.returncode == 0


def test_untracked_python_file_triggers_check(repo, tmp_path):
    (repo / "pkg").mkdir()
    (repo / "pkg" / "new.py").write_text("y = 1\n")
    result = _run(repo, _fake_make(tmp_path, 1, "LINT ERROR"))
    assert result.returncode == 2


def test_modified_settings_json_triggers_check(repo, tmp_path):
    (repo / ".claude").mkdir()
    (repo / ".claude" / "settings.json").write_text("{}")
    result = _run(repo, _fake_make(tmp_path, 1, "LINT ERROR"))
    assert result.returncode == 2
