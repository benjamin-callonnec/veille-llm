import re
from pathlib import Path

import pytest

from veille_llm.pipeline import version
from veille_llm.pipeline.version import (
    PIPELINE_VERSION,
    SOURCES_HASH,
    bump,
    classify_provenance,
    hooks_provenance,
    outdated,
    prompt_hash,
    sources_hash,
)

ROOT = Path(__file__).resolve().parents[2]


def test_the_recorded_hash_matches_the_result_affecting_files():
    # Fails when filtering, classification, hooks, consolidation or the LLM settings changed
    # without a version decision. Fix with:  uv run python -m veille_llm.pipeline.version bump
    # patch|minor|major  (patch = no effect on results, minor/major = results change).
    assert sources_hash() == SOURCES_HASH, "bump the pipeline version (see the comment above)"


def test_pipeline_version_is_a_semver():
    assert re.fullmatch(r"\d+\.\d+\.\d+", PIPELINE_VERSION)


def test_prompt_hash_changes_with_the_instructions_and_the_schema():
    base = prompt_hash("do it", {"a": 1})
    assert prompt_hash("do it", {"a": 1}) == base
    assert prompt_hash("do it again", {"a": 1}) != base
    assert prompt_hash("do it", {"a": 2}) != base


def test_provenance_carries_model_prompt_and_pipeline_version():
    p = classify_provenance("claude-haiku-5-5")
    assert p.model == "claude-haiku-5-5" and p.pipeline == PIPELINE_VERSION
    assert p.prompt != hooks_provenance("claude-haiku-5-5").prompt


def test_outdated_rules():
    cur = classify_provenance("m")
    same = type(cur)(cur.model, cur.prompt, cur.pipeline)
    assert not outdated(same, cur)
    assert outdated(type(cur)("other-model", cur.prompt, cur.pipeline), cur)
    assert outdated(type(cur)(cur.model, "other-prompt", cur.pipeline), cur)


def test_patch_never_invalidates_but_minor_and_major_do():
    cur = classify_provenance("m")
    major, minor, patch = (int(x) for x in PIPELINE_VERSION.split("."))
    with_pipeline = lambda v: type(cur)(cur.model, cur.prompt, v)  # noqa: E731
    assert not outdated(with_pipeline(f"{major}.{minor}.{patch + 7}"), cur)
    assert outdated(with_pipeline(f"{major}.{minor + 1}.0"), cur)
    assert outdated(with_pipeline(f"{major + 1}.0.0"), cur)


def test_legacy_rows_are_never_outdated():
    from veille_llm.models import LEGACY

    assert not outdated(LEGACY, classify_provenance("m"))


def test_bump_rewrites_version_and_hash_atomically(tmp_path):
    target = tmp_path / "version.py"
    target.write_text('PIPELINE_VERSION = "1.2.3"\nSOURCES_HASH = "old"\n')
    assert bump("minor", target, new_hash="abc") == "1.3.0"
    text = target.read_text()
    assert 'PIPELINE_VERSION = "1.3.0"' in text and 'SOURCES_HASH = "abc"' in text
    assert bump("major", target, new_hash="d") == "2.0.0"
    assert bump("patch", target, new_hash="e") == "2.0.1"
    with pytest.raises(ValueError):
        bump("huge", target, new_hash="f")


def test_files_that_do_not_affect_results_are_outside_the_hash():
    names = {Path(f).name for f in version.RESULT_FILES}
    assert {"filtering.py", "classify.py", "categorize.py", "consolidate.py", "llm.py"} <= names
    assert not names & {"run.py", "export.py", "progress.py", "cli.py", "render.py"}
    assert all((ROOT / "src" / "veille_llm" / f).exists() for f in version.RESULT_FILES)
