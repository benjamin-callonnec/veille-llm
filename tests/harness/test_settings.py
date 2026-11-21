import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / ".claude" / "settings.json"


def _load() -> dict:
    return json.loads(SETTINGS.read_text())


def test_settings_is_valid_json():
    assert isinstance(_load(), dict)


def test_stop_hook_registered_and_executable():
    entries = _load()["hooks"]["Stop"]
    commands = [h["command"] for entry in entries for h in entry["hooks"]]
    assert commands, "no Stop hook command registered"
    script = ROOT / commands[0].replace('"$CLAUDE_PROJECT_DIR"/', "").replace(
        "$CLAUDE_PROJECT_DIR/", ""
    )
    assert script.is_file()
    assert os.access(script, os.X_OK)


def test_force_push_and_private_files_are_denied():
    deny = set(_load()["permissions"]["deny"])
    assert {
        "Bash(git push --force:*)",
        "Bash(git push -f:*)",
        "Bash(git push --force-with-lease:*)",
        "Bash(git commit --no-verify:*)",
        "Bash(git commit -n:*)",
        "Read(**/.env)",
        "Read(**/.env.*)",
        "Read(**/subscribers.txt)",
        "Bash(gh secret list:*)",
    } <= deny


def test_every_git_push_asks_for_approval():
    assert "Bash(git push:*)" in _load()["permissions"]["ask"]
