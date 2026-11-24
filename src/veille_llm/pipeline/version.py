"""Version of the ingestion pipeline: what decides whether stored LLM results are outdated.

This is not the product version (`pyproject.toml`, which covers the web app, the newsletter and
the workflows). `PIPELINE_VERSION` only moves when something that can change a result changes:
    patch  no effect on results (a log line, an optimisation): never invalidates anything;
    minor  results change a little (a rule, a threshold, a prompt tweak): outdated results are
           recomputed lazily;
    major  results change a lot: same, and it says so loudly.
A change of model or of prompt (hash) also makes a result outdated, whatever the version.

`SOURCES_HASH` records the files that affect results; a test fails when they changed without a
version decision. Decide with:  uv run python -m veille_llm.pipeline.version bump patch|minor|major
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

PIPELINE_VERSION = "1.1.1"
SOURCES_HASH = "da91df6414549d13"

# Relative to src/veille_llm: the files whose changes can alter a stored result.
RESULT_FILES = (
    "pipeline/filtering.py",
    "pipeline/classify.py",
    "pipeline/categorize.py",
    "pipeline/consolidate.py",
    "pipeline/resilient.py",
    "llm.py",
)

_ROOT = Path(__file__).resolve().parents[1]


def sources_hash() -> str:
    digest = hashlib.sha256()
    for name in RESULT_FILES:
        digest.update(name.encode())
        digest.update((_ROOT / name).read_bytes())
    return digest.hexdigest()[:16]


def prompt_hash(instructions: str, schema: dict) -> str:
    payload = instructions + json.dumps(schema, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def classify_provenance(model: str):
    from veille_llm.models import Provenance
    from veille_llm.pipeline.classify import CLASSIFY_SCHEMA, INSTRUCTIONS

    return Provenance(model, prompt_hash(INSTRUCTIONS, CLASSIFY_SCHEMA), PIPELINE_VERSION)


def hooks_provenance(model: str):
    from veille_llm.models import Provenance
    from veille_llm.pipeline.categorize import CAP_REACHED, ENRICH_SCHEMA, INSTRUCTIONS

    return Provenance(
        model, prompt_hash(INSTRUCTIONS + CAP_REACHED, ENRICH_SCHEMA), PIPELINE_VERSION
    )


def _minor(version: str) -> tuple[str, str]:
    parts = version.split(".")
    return parts[0], parts[1] if len(parts) > 1 else ""


def outdated(stored, current) -> bool:
    """Should a result stored with `stored` be recomputed under `current`?

    Rows written before provenance existed are never outdated: a migration must not trigger a
    full, paid recomputation.
    """
    if stored.model == "legacy":
        return False
    return (
        stored.model != current.model
        or stored.prompt != current.prompt
        or _minor(stored.pipeline) != _minor(current.pipeline)
    )


def bump(level: str, path: Path | None = None, *, new_hash: str | None = None) -> str:
    """Raise the version and record the current hash of the result files, together."""
    if level not in ("patch", "minor", "major"):
        raise ValueError("level must be patch, minor or major")
    target = path or Path(__file__)
    text = target.read_text()
    match = re.search(r'^PIPELINE_VERSION = "(\d+)\.(\d+)\.(\d+)"$', text, re.MULTILINE)
    if match is None:
        raise ValueError("PIPELINE_VERSION line not found")
    major, minor, patch = (int(x) for x in match.groups())
    new = {
        "major": (major + 1, 0, 0),
        "minor": (major, minor + 1, 0),
        "patch": (major, minor, patch + 1),
    }[level]
    version = ".".join(str(n) for n in new)
    text = re.sub(
        r'^PIPELINE_VERSION = ".*"$', f'PIPELINE_VERSION = "{version}"', text, flags=re.MULTILINE
    )
    text = re.sub(
        r'^SOURCES_HASH = ".*"$',
        f'SOURCES_HASH = "{new_hash or sources_hash()}"',
        text,
        flags=re.MULTILINE,
    )
    target.write_text(text)
    return version


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args[:1] == ["bump"] and len(args) == 2:
        print(f"PIPELINE_VERSION is now {bump(args[1])}")
        return 0
    if args[:1] == ["show"]:
        print(f"{PIPELINE_VERSION} (files hash {sources_hash()}, recorded {SOURCES_HASH})")
        return 0
    print("usage: python -m veille_llm.pipeline.version show | bump patch|minor|major")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
