from pathlib import Path

CI = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml").read_text()


def test_ci_installs_locked_dependencies_and_checks_and_builds_the_web_app():
    assert "actions/setup-node" in CI
    assert "make install" in CI and "make check" in CI and "make web-build" in CI


def test_make_install_uses_the_lockfiles():
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    assert "uv sync --locked" in makefile
    assert "npm ci" in makefile


def test_public_workflows_never_build_the_local_reader():
    workflows = (Path(__file__).resolve().parents[2] / ".github" / "workflows").glob("*.yml")
    for workflow in workflows:
        text = workflow.read_text()
        assert "VITE_READER_URL" not in text, workflow.name
        assert "--mode reader" not in text, workflow.name


def test_make_has_a_local_reader_target():
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    assert "\nreader:" in makefile
    assert "--mode reader" in makefile and "veille-reader serve" in makefile


def test_default_web_build_leaves_the_reader_out(tmp_path):
    import shutil
    import subprocess

    web = Path(__file__).resolve().parents[2] / "web"
    if not (web / "node_modules").is_dir() or shutil.which("npx") is None:
        import pytest

        pytest.skip("web dependencies not installed")
    subprocess.run(
        ["npx", "vite", "build", "--outDir", str(tmp_path / "dist"), "--emptyOutDir"],
        cwd=web,
        check=True,
        capture_output=True,
    )
    assert (tmp_path / "dist" / "index.html").is_file()
    assert not (tmp_path / "dist" / "reader.html").exists()
    names = [p.name for p in (tmp_path / "dist").rglob("*") if p.is_file()]
    assert not [
        n for n in names if any(w in n.lower() for w in ("pdf", "reader", "katex", "markdown"))
    ], names


def test_make_reader_reloads_on_change_and_never_bills_per_token():
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    recipe = makefile.split("\nreader:")[1].split("\n\n")[0]
    assert "--reload" in recipe and "vite" in recipe
    for name in (
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
    ):
        assert f"-u {name}" in makefile, name


def test_both_pages_declare_the_favicon_and_it_exists():
    web = Path(__file__).resolve().parents[2] / "web"
    assert (web / "public" / "favicon.svg").is_file()
    for page in ("index.html", "reader.html"):
        html = (web / page).read_text()
        assert 'rel="icon"' in html and "favicon.svg" in html, page


def test_make_catalogue_downloads_the_published_catalogue_safely():
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    assert "\ncatalogue:" in makefile
    recipe = makefile.split("\ncatalogue:")[1].split("\n\n")[0]
    assert "benjamin-callonnec.github.io/veille-llm/catalogue.json" in makefile
    assert "build/catalogue.json" in recipe and "curl" in recipe
    # download to a temporary file, validate it, then move it into place (never a half file)
    assert ".tmp" in recipe and "mv " in recipe and "items" in recipe


def test_make_reader_fetches_the_catalogue_when_it_is_missing():
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    for target in ("reader", "reader-build"):
        recipe = makefile.split(f"\n{target}:")[1].split("\n\n")[0]
        assert "$(MAKE) catalogue" in recipe, target
