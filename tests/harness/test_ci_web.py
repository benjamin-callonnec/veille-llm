from pathlib import Path

CI = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml").read_text()


def test_ci_installs_locked_dependencies_and_checks_and_builds_the_web_app():
    assert "actions/setup-node" in CI
    assert "make install" in CI and "make check" in CI and "make web-build" in CI


def test_make_install_uses_the_lockfiles():
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    assert "uv sync --locked" in makefile
    assert "npm ci" in makefile
