# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).
Each merge of `develop` into `main` gets a version (see `.claude/skills/release`).

## [Unreleased]

## [0.4.0] - 2026-11-22

### Added
- Each published item now carries a `brief` (2-3 plain sentences) next to a much shorter `hook` (at most 120 characters, written to make you want to read without overselling). Existing databases get the new column automatically. Pipeline side of #11; the bold hook display belongs to the web front.

### Changed
- The v0 GitHub Pages front is English only (labels, placeholders, date format, `lang`).

## [0.3.0] - 2026-11-22

### Added
- `--max-batches` (default 20) caps LLM batches per run, shared by classification and hooks (a third of the budget is kept for hooks when some wait); the rest resumes on the next run.
- `daily.yml`: scheduled run in three jobs. `core` (LLM token, read-only) restores `veille.db` from the orphan `data` branch and runs the pipeline; `persist` (only job with write access, no third-party code) republishes the database even on failure; `deploy` (no secret) publishes Pages. The run fails visibly if the LLM stops or rejects every batch.
- `veille_llm.persist`: verified snapshot of the database (integrity check, crashed transaction rolled back) published as a single commit on `data`; remote URLs with tokens are never echoed.

### Changed
- `pages.yml` is removed: `daily.yml` is the only Pages deployer (run it manually to redeploy).
- `--max-batches` must be at least 1.

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
