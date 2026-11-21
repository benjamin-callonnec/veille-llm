import re
from pathlib import Path

CONFIG = (Path(__file__).resolve().parents[2] / ".pre-commit-config.yaml").read_text()


def _forbid_regex() -> re.Pattern:
    block = CONFIG[CONFIG.index("id: forbid-private-files") :]
    return re.compile(re.search(r"files: (.+)", block).group(1).strip())


def test_check_json_hook_is_enabled():
    assert "id: check-json" in CONFIG


def test_forbid_hook_blocks_env_variants_and_subscribers():
    rx = _forbid_regex()
    for name in [
        ".env",
        ".env.local",
        ".env.production",
        "services/newsletter/.env",
        "subscribers.txt",
        "a/subscribers.txt",
    ]:
        assert rx.search(name), name


def test_forbid_hook_allows_env_example_and_lookalikes():
    rx = _forbid_regex()
    for name in [".env.example", "environment.py", "my.environment", "subscribers.txt.md"]:
        assert not rx.search(name), name
