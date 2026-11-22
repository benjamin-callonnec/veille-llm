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
    assert args.data_dir == cli.ROOT / ".local/reader"
    assert args.catalogue == cli.ROOT / "build/catalogue.json"
    assert args.static == cli.ROOT / "web/dist"
    assert cli.ROOT.joinpath("pyproject.toml").is_file()


def test_missing_catalogue_exits_with_message(tmp_path, capsys):
    code = cli.main(
        ["serve", "--data-dir", str(tmp_path), "--catalogue", str(tmp_path / "no.json")]
    )
    assert code == 1
    assert "catalogue" in capsys.readouterr().err


def test_reload_flag_defaults_off_and_is_a_flag():
    assert cli.parse_args(["serve"]).reload is False
    assert cli.parse_args(["serve", "--reload"]).reload is True


def test_reload_runs_an_app_factory_that_uvicorn_can_restart(tmp_path):
    cat = tmp_path / "c.json"
    cat.write_text('{"items": []}', encoding="utf-8")
    with patch.object(cli.uvicorn, "run") as run:
        code = cli.main(
            ["serve", "--reload", "--data-dir", str(tmp_path / "d"), "--catalogue", str(cat)]
        )
    assert code == 0
    assert run.call_args.args[0] == "veille_reader.cli:reload_app"
    kwargs = run.call_args.kwargs
    assert kwargs["factory"] is True and kwargs["reload"] is True
    assert kwargs["host"] == "127.0.0.1"
    assert str(cli.ROOT / "src") in kwargs["reload_dirs"]


def test_reload_app_builds_the_app_from_the_environment(tmp_path, monkeypatch):
    cat = tmp_path / "c.json"
    cat.write_text('{"items": []}', encoding="utf-8")
    monkeypatch.setenv("VEILLE_READER_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("VEILLE_READER_CATALOGUE", str(cat))
    monkeypatch.setenv("VEILLE_READER_STATIC", "")
    app = cli.reload_app()
    assert any(r.path == "/api/health" for r in app.routes)


def test_reload_mode_allows_the_vite_dev_origin(tmp_path, monkeypatch):
    cat = tmp_path / "c.json"
    cat.write_text('{"items": [{"id": "a", "title": "t", "url": "u"}]}', encoding="utf-8")
    monkeypatch.setenv("VEILLE_READER_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("VEILLE_READER_CATALOGUE", str(cat))
    monkeypatch.setenv("VEILLE_READER_STATIC", "")
    monkeypatch.setenv("VEILLE_READER_DEV_ORIGINS", "http://127.0.0.1:5173")
    from fastapi.testclient import TestClient

    client = TestClient(cli.reload_app(), base_url="http://127.0.0.1:8765")
    response = client.post(
        "/api/items/a/conversations", json={}, headers={"Origin": "http://127.0.0.1:5173"}
    )
    assert response.status_code == 201


def test_dev_front_flag_is_passed_to_the_reloading_app(tmp_path):
    cat = tmp_path / "c.json"
    cat.write_text('{"items": []}', encoding="utf-8")
    assert cli.parse_args(["serve"]).dev_front is None
    with patch.object(cli.uvicorn, "run"):
        code = cli.main(
            [
                "serve",
                "--reload",
                "--dev-front",
                "http://127.0.0.1:5173",
                "--data-dir",
                str(tmp_path / "d"),
                "--catalogue",
                str(cat),
            ]
        )
    assert code == 0
    import os

    assert os.environ["VEILLE_READER_DEV_FRONT"] == "http://127.0.0.1:5173"


def test_reload_app_redirects_pages_when_a_dev_front_is_configured(tmp_path, monkeypatch):
    cat = tmp_path / "c.json"
    cat.write_text('{"items": []}', encoding="utf-8")
    monkeypatch.setenv("VEILLE_READER_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("VEILLE_READER_CATALOGUE", str(cat))
    monkeypatch.setenv("VEILLE_READER_STATIC", "")
    monkeypatch.setenv("VEILLE_READER_DEV_FRONT", "http://127.0.0.1:5173")
    from fastapi.testclient import TestClient

    client = TestClient(cli.reload_app(), base_url="http://127.0.0.1:8765", follow_redirects=False)
    assert client.get("/reader.html").headers["location"] == "http://127.0.0.1:5173/reader.html"
