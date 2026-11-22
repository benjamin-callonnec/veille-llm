# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).
Each merge of `develop` into `main` gets a version (see `.claude/skills/release`).

## [Unreleased]

### Added
- `--max-batches` (default 20) caps LLM batches per run, shared by classification and hooks; the rest resumes on the next run.

## [0.2.0] - 2026-11-22

### Added
- Core pipeline: resilient sources (arXiv, Hugging Face, RSS), deterministic filter, resumable LLM classification, dynamic categories and safe hooks, atomic JSON export, `veille-core run` CLI.
- LLM layer on the Claude subscription: billing guard, typed errors, redaction, validated JSON output, untrusted data in an escaped block.
- `--model` option; Haiku 5.5 is the default model for classification and hooks.
- Dev harness: CLAUDE.md, project skills, pre-commit with secret scanning, stop hook, CI on push to `main`, gitflow.
- `scripts/compare_models.py` to compare a model with stored verdicts.

### Fixed
- Batches lost to over-long category hints; Hugging Face upvotes never refreshed; unsafe category names.
- Prompts now name every required key (Haiku dropped `interesting`).

## [0.1.0] - 2026-11-20

### Added
- First static catalogue of arXiv and Hugging Face papers on GitHub Pages.
