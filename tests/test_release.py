import tomllib
from pathlib import Path

import pytest

from veille_llm.release import latest_version, section

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = """# Changelog

## [Unreleased]

## [0.2.0] - 2026-11-22

### Added
- Thing

## [0.1.0] - 2026-11-20

- First
"""


def test_latest_version_skips_unreleased():
    assert latest_version(SAMPLE) == "0.2.0"


def test_section_returns_only_that_versions_notes():
    notes = section(SAMPLE, "0.2.0")
    assert "- Thing" in notes and "First" not in notes and "## [" not in notes


def test_section_of_unknown_version_raises():
    with pytest.raises(ValueError):
        section(SAMPLE, "9.9.9")


def test_pyproject_version_matches_latest_changelog_entry():
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    changelog = (ROOT / "CHANGELOG.md").read_text()
    assert latest_version(changelog) == version
    assert section(changelog, version).strip()


def test_release_workflow_is_the_only_one_with_write_access():
    workflows = ROOT / ".github" / "workflows"
    release = (workflows / "release.yml").read_text()
    assert "contents: write" in release
    assert "branches: [main]" in release
    assert "secrets." not in release.replace("secrets.GITHUB_TOKEN", "")
    for other in workflows.glob("*.yml"):
        if other.name != "release.yml":
            assert "contents: write" not in other.read_text()
