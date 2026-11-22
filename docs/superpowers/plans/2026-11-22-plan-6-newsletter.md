# Plan 6 — Weekly newsletter and subscribers (issue #4)

**Goal:** every Monday, send the same HTML + text mail (Jinja2) with the best items of the week to
each subscriber, once per week, with no address ever in git, logs or the public `data` branch.
**Spec:** `docs/superpowers/specs/2026-11-21-veille-llm-design.md` sections 5.3 and 5.4.

## Decisions (mine unless the spec says so)
- Selection: published items of the last 7 days (by `published`), best `score` first (ties: upvotes, then newest), at most 8. No item: send nothing, exit 0 (author's decision: nothing interesting means no mail; `MIN_ITEMS = 0`).
- Week id is the ISO week of the run (`2026-W47`). The marker table `newsletter(week, delivered, total)` lives in `veille.db`; it holds **counts only, never addresses or hashes** (the `data` branch is public). Recipients are sorted; a rerun resumes at `delivered`, so a partial failure never double-sends.
- Subscribers: `SubscriberStore.list()`; `EnvSubscribers` (secret `SUBSCRIBERS`, comma separated) in CI, `FileSubscribers` (`subscribers.txt`, gitignored) locally. Lowercased, deduplicated, anything that is not a plain address (or contains CR/LF) is dropped and counted.
- Delivery: SMTP (STARTTLS or SSL by port) from secrets `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `NEWSLETTER_FROM`, `NEWSLETTER_CONTACT` (unsubscribe mailto, also the `List-Unsubscribe` header). One mail per recipient, never a list in "To".
- Logs: `::add-mask::` for every address before anything else; only counts are printed.
- Template: autoescaped Jinja2, links only `http(s)`, English. Item: category, title link, hook in bold, brief.
- `veille-newsletter send --db veille.db [--dry-run --out build/newsletter.html] [--week 2026-W47]`; dry run renders and writes the files, sends nothing, needs no SMTP.
- `make subs-add|subs-remove|subs-list|subs-push EMAIL=...` (local file; push uses `gh secret set` with the personal account).
- `weekly.yml`: Monday 08:00 UTC and manual, same `data-branch` concurrency group; `send` job (secrets, read-only) then `persist` job (write, plain python) like `daily.yml`.

## Tasks (failing test first, commit on `develop`)
1. Subscribers: parsing/validation, stores, `scripts/subs.py` and Makefile targets.
2. Selection and weekly marker in `Store` (`newsletter_progress`, `record_delivery`).
3. Rendering: Jinja2 templates (HTML + text), safe links, unsubscribe footer.
4. SMTP sender and `send_newsletter` orchestration + `veille-newsletter` CLI.
5. `weekly.yml` and harness tests.
6. Docs, review (opus), release.

## Review focus
Header injection via an address or item text; an address appearing in any log, exception or the db; resend after partial failure; changing subscriber list between a failed run and its retry; week boundary (Sunday night); fewer than 3 items; HTML escaping of LLM text; SMTP password in tracebacks.
