import importlib.util
import os
import stat
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "reader_token.py"
TOKEN = "sk-ant-oat01-SECRETSECRETSECRET"


@pytest.fixture
def script():
    spec = importlib.util.spec_from_file_location("reader_token", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_token_is_written_to_a_private_file(script, tmp_path):
    path = tmp_path / ".env"
    script.write_token(path, TOKEN)
    assert path.read_text(encoding="utf-8") == f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}\n"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


def test_other_lines_are_kept_and_an_old_token_is_replaced(script, tmp_path):
    path = tmp_path / ".env"
    path.write_text("# mine\nFOO=bar\nCLAUDE_CODE_OAUTH_TOKEN=old\nBAZ=1\n", encoding="utf-8")
    script.write_token(path, TOKEN)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines == ["# mine", "FOO=bar", f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}", "BAZ=1"]
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


@pytest.mark.parametrize("bad", ["", "   ", "hello", "sk-api-xxx", "sk-ant-"])
def test_an_invalid_token_is_refused_and_nothing_is_written(script, tmp_path, bad):
    path = tmp_path / ".env"
    with pytest.raises(ValueError):
        script.write_token(path, bad)
    assert not path.exists()


def test_the_token_is_never_printed(script, tmp_path, capsys):
    path = tmp_path / ".env"
    code = script.main(["--env-file", str(path)], ask=lambda prompt: TOKEN)
    out = capsys.readouterr()
    assert code == 0
    assert TOKEN not in out.out and TOKEN not in out.err
    assert ".env" in out.out
    assert path.read_text(encoding="utf-8") == f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}\n"


def test_an_invalid_entry_exits_with_an_error_and_does_not_echo_it(script, tmp_path, capsys):
    path = tmp_path / ".env"
    code = script.main(["--env-file", str(path)], ask=lambda prompt: "not-a-token-XYZ")
    out = capsys.readouterr()
    assert code == 1
    assert "not-a-token-XYZ" not in out.out + out.err
    assert not path.exists()
