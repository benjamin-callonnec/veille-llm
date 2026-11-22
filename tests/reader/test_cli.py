from pathlib import Path
from unittest.mock import patch

from veille_reader import cli


def test_serve_binds_loopback_only(tmp_path):
    cat = tmp_path / "c.json"
    cat.write_text('{"items": []}', encoding="utf-8")
    with patch.object(cli.uvicorn, "run") as run:
        code = cli.main(
            ["serve", "--data-dir", str(tmp_path / "d"), "--catalogue", str(cat), "--port", "9000"]
        )
    assert code == 0
    assert run.call_args.kwargs["host"] == "127.0.0.1"
    assert run.call_args.kwargs["port"] == 9000


def test_no_host_option():
    with patch.object(cli.uvicorn, "run"):
        try:
            cli.main(["serve", "--host", "0.0.0.0"])
        except SystemExit as exc:
            assert exc.code == 2


def test_defaults():
    args = cli.parse_args(["serve"])
    assert args.port == 8765
    assert args.data_dir == Path(".local/reader")
    assert args.catalogue == Path("build/catalogue.json")
    assert args.static == Path("web/dist")


def test_missing_catalogue_exits_with_message(tmp_path, capsys):
    code = cli.main(
        ["serve", "--data-dir", str(tmp_path), "--catalogue", str(tmp_path / "no.json")]
    )
    assert code == 1
    assert "catalogue" in capsys.readouterr().err
