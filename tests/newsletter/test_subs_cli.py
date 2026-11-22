import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import subs  # noqa: E402


def run(tmp_path, *argv):
    return subs.main([*argv], path=tmp_path / "subscribers.txt")


def test_add_creates_the_file_sorted_and_without_duplicates(tmp_path, capsys):
    assert run(tmp_path, "add", "b@x.org") == 0
    assert run(tmp_path, "add", "A@x.org") == 0
    assert run(tmp_path, "add", "a@x.org") == 0
    assert (tmp_path / "subscribers.txt").read_text() == "a@x.org\nb@x.org\n"


def test_add_refuses_an_invalid_address(tmp_path):
    assert run(tmp_path, "add", "nope") == 1
    assert not (tmp_path / "subscribers.txt").exists()


def test_remove_and_list(tmp_path, capsys):
    run(tmp_path, "add", "a@x.org")
    run(tmp_path, "add", "b@x.org")
    assert run(tmp_path, "remove", "a@x.org") == 0
    capsys.readouterr()
    run(tmp_path, "list")
    assert capsys.readouterr().out.split() == ["b@x.org"]


def test_remove_unknown_address_is_reported(tmp_path):
    assert run(tmp_path, "remove", "ghost@x.org") == 1


def test_push_calls_gh_with_the_personal_account_and_never_echoes_addresses(tmp_path, capsys):
    run(tmp_path, "add", "a@x.org")
    calls = []

    def fake_gh(cmd, text, token):
        calls.append((cmd, text, token))
        return 0

    assert subs.main(["push"], path=tmp_path / "subscribers.txt", gh=fake_gh, token="tok") == 0
    cmd, text, token = calls[0]
    assert cmd[:3] == ["gh", "secret", "set"] and "SUBSCRIBERS" in cmd
    assert "-R" in cmd and "benjamin-callonnec/veille-llm" in cmd
    assert text == "a@x.org" and token == "tok"
    assert "a@x.org" not in capsys.readouterr().out


def test_push_refuses_an_empty_list_instead_of_wiping_the_secret(tmp_path):
    calls = []
    code = subs.main(
        ["push"], path=tmp_path / "missing.txt", gh=lambda *a: calls.append(a) or 0, token="t"
    )
    assert code == 1 and calls == []


def test_gh_gets_a_home_directory_so_it_never_writes_state_into_the_repo():
    env = subs._gh_env("tok")
    assert env["GH_TOKEN"] == "tok" and env["HOME"]
