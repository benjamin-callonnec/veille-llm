import os
import stat

from veille_reader.env import ALLOWED_KEYS, load_env_file, parse_env, permission_warning

TOKEN = "sk-ant-oat01-SECRETSECRETSECRET"
TRAILING = "  "  # trailing spaces on purpose, built here so no editor or hook strips them


def test_parse_handles_comments_quotes_export_and_blank_lines():
    text = f"""
# a comment
CLAUDE_CODE_OAUTH_TOKEN={TOKEN}
export OTHER="quoted value"
SINGLE='single'
  SPACED = spaced value
EMPTY=
not a pair
=novalue
"""
    parsed = parse_env(text)
    assert parsed["CLAUDE_CODE_OAUTH_TOKEN"] == TOKEN
    assert parsed["OTHER"] == "quoted value"
    assert parsed["SINGLE"] == "single"
    assert parsed["SPACED"] == "spaced value"
    assert parsed["EMPTY"] == ""
    assert "not a pair" not in parsed and "" not in parsed


def test_only_the_token_is_ever_loaded_from_the_file(tmp_path):
    assert ALLOWED_KEYS == {"CLAUDE_CODE_OAUTH_TOKEN"}
    path = tmp_path / ".env"
    path.write_text(
        f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}\nANTHROPIC_API_KEY=sk-ant-api03-bill-me\n"
        "CLAUDE_CODE_USE_VERTEX=1\nANTHROPIC_BASE_URL=https://evil.example\n",
        encoding="utf-8",
    )
    environ: dict[str, str] = {}
    loaded = load_env_file(path, environ)
    assert loaded == ["CLAUDE_CODE_OAUTH_TOKEN"]
    assert environ == {"CLAUDE_CODE_OAUTH_TOKEN": TOKEN}  # nothing that bills per token


def test_the_real_environment_wins_over_the_file(tmp_path):
    path = tmp_path / ".env"
    path.write_text(f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}\n", encoding="utf-8")
    environ = {"CLAUDE_CODE_OAUTH_TOKEN": "from-the-shell"}
    assert load_env_file(path, environ) == []
    assert environ["CLAUDE_CODE_OAUTH_TOKEN"] == "from-the-shell"


def test_a_missing_or_unreadable_file_is_not_an_error(tmp_path):
    assert load_env_file(tmp_path / "nope", {}) == []
    directory = tmp_path / "dir"
    directory.mkdir()
    assert load_env_file(directory, {}) == []


def test_an_empty_token_is_not_loaded(tmp_path):
    path = tmp_path / ".env"
    path.write_text("CLAUDE_CODE_OAUTH_TOKEN=\n", encoding="utf-8")
    environ: dict[str, str] = {}
    assert load_env_file(path, environ) == []
    assert environ == {}


def test_the_returned_names_never_contain_the_secret(tmp_path):
    path = tmp_path / ".env"
    path.write_text(f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}\n", encoding="utf-8")
    loaded = load_env_file(path, {})
    assert TOKEN not in repr(loaded)


def test_a_file_readable_by_others_triggers_a_warning_without_the_secret(tmp_path):
    path = tmp_path / ".env"
    path.write_text(f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}\n", encoding="utf-8")
    os.chmod(path, 0o644)
    warning = permission_warning(path)
    assert warning and "chmod 600" in warning and TOKEN not in warning
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    assert permission_warning(path) is None
    assert permission_warning(tmp_path / "missing") is None
