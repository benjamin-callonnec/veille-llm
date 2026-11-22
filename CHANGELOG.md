# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).
Each merge of `develop` into `main` gets a version (see `.claude/skills/release`).

## [Unreleased]

### Fixed
- Cards of any item with an arXiv PDF open the reader when clicked (benchmarks too: the 60 benchmark items were left out because only the "paper" type counted); items without a PDF stay plain.
- `make reader` rebuilds the static front (`web/dist`, served on port 8765) every time it starts, so that port is never an older version than the hot-reload dev server on 5173 (you could see an old "Read" link and no shortcuts gear there).
- The local catalogue showed no briefs: `build/catalogue.json` was an old local file from before briefs existed. `make catalogue` now downloads the published catalogue (with hooks and briefs) into `build/catalogue.json` safely (temporary file, validated, then moved), and `make reader` / `make reader-build` run it when the file is missing.
- The "Read" link no longer carries a port written at build time (it was wrong when the front had been built for another port): it is relative to the catalogue page, so it works from the dev server and from the built front.

### Added
- `make reader`: opening the API port (`http://127.0.0.1:8765`) now redirects the pages to the hot-reload front on 5173, so front changes always show up without relaunching; the static build on 8765 was what looked "not reloaded". (`veille-reader serve --reload --dev-front URL`.)
- The keyboard shortcuts follow your keyboard: on a Mac they show ⌥ (Option), Return, ⇧ and fn with an arrow for PageUp/PageDown; on Windows and Linux they show Alt, Enter, Shift, PageUp and PageDown. The platform is detected from the browser.
- The title of each page sits on the same line as the logo, to its right (the catalogue now has the same page head as the reader).
- A shared app shell: the logo (home button, goes to the catalogue) is fixed in the top-left corner and the settings gear in the bottom-left corner, at the same place on every page, provided by one component (`AppShell`) so pages do not render them and any new page gets them for free. The gear opens the settings: theme (Auto follows the system, Papier light, Nuit dark; remembered) and the keyboard shortcuts of the current page. `?` opens and closes it. On the catalogue, `/` jumps to the search box.
- Paper cards open the reader when you click anywhere on the card (an invisible link covers the card); the title still opens the original article in a new tab. The visible "Read" link is gone.
- A logo for the web app: the "Lw" monogram in a rounded square, coloured by the Papier / Nuit theme. It is the favicon of both pages and the home button on every page.

## [0.12.0] - 2026-11-22

### Added
- Reader chat core (#22, part of #17): a streaming chat with the tutor in the right pane. Answers stream token by token (stop and regenerate), your questions about a passage appear as a quote with its page and a "p.N" link back to the PDF, `[p.N]` citations in answers scroll the PDF, Markdown and math are rendered safely (raw HTML as text, only http(s) links, no remote images). Conversations are kept per paper (dropdown in the chat header: new, rename, delete, export to Markdown).
- A discreet "Thinking" line above each answer (no box, transparent): open while the agent works, folded automatically when the answer starts, reopenable at any time, also from history. It shows the reasoning and, later, the tools with their inputs.
- Server: conversations and messages (migration 3), a streaming endpoint (SSE) with a pluggable agent runner, and a Claude Agent SDK runner on the subscription (no API key, no tools, summarized thinking, Sonnet by default, `VEILLE_READER_MODEL` to change). The tutor only sees the title, summary and selected passage until #23 adds tools.
- Panes: no more Hide/Show buttons; a small cross collapses a pane (a thin "+" rail brings it back) and **Alt+1** / **Alt+2** toggle the PDF and the chat.
- `make reader` now runs with auto-reload (API restarts on Python changes, front hot-reloads with Vite on `127.0.0.1:5173`) and removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX` for its own processes (the reader refuses them otherwise). `make reader-build` keeps the single-process, no-reload mode.

### Fixed
- Stop keeps the partial answer (the request cancellation used to lose it), a streaming conversation cannot be deleted, and switching conversation during a stream no longer mixes the views. Asking while an answer streams keeps your question box with a notice, long selections are clipped to what the server accepts, and the error banner clears on the next action.

## [0.11.0] - 2026-11-22

### Added
- Reader PDF viewer and panes (#21, part of #17): pdf.js viewer (pinned `pdfjs-dist`, scripting and eval off, PDF links never rendered) with zoom, search (`/`), outline, keyboard navigation and a bounded number of rendered pages, so a 300-page PDF stays responsive. The page is kept in the URL.
- Selection box next to a selected passage: a question field (Enter), three highlight colours (yellow, green, red) and Copy. Highlights are stored per paper in the local database (new routes `GET/POST/DELETE /api/items/{id}/highlights`, migration 2) and listed under the PDF with jump-to and filter.
- Two panes PDF | chat, resizable by dragging or with the arrow keys and collapsible, layout remembered. The right pane lists the questions asked until the chat arrives (#22).

### Fixed
- Review follow-ups of the reader: a catalogue whose items are not a list is rejected, the server picks up a regenerated catalogue, default paths are anchored at the repo root, a test checks that the default web build leaves the reader out, the IPv6 literal is no longer a local host.
- Viewer review fixes: no scroll snap-back when new pages load, renders cancelled when zooming, page memory released, canvas size capped, long selections trimmed and merged per line, failed highlight saves reported, text layer capped and batched.

## [0.10.0] - 2026-11-22

### Added
- Local paper reader foundations (#20, part of #17): a separate `veille_reader` module with a local FastAPI server (`veille-reader serve`, 127.0.0.1 only, `make reader`), versioned SQLite storage and a PDF cache under `.local/reader/` (gitignored). arXiv PDFs are fetched from arxiv.org on first use (size cap, `%PDF` check, redirects only inside arxiv.org) and never redistributed.
- A "Read" link on paper cards and a placeholder `reader.html` page, built only by `make reader`; the public Pages build contains neither (checked by a harness test).
- The server refuses non-local `Host` headers and cross-site requests, so a web page visited by the author cannot make it download papers.

## [0.9.0] - 2026-11-22

### Added
- LLM result caching by version (#16). Every verdict and hook now records the **model**, a **prompt hash** and the **ingestion pipeline version** (`PIPELINE_VERSION`, separate from the product version; patch never invalidates, minor and major do). Results made under another model, prompt or minor/major version are recomputed lazily with the batch budget left after new items, one verdict or hook at a time, never unpublishing an item and never touching a category chosen by consolidation. Rows from before this release are marked `legacy` and are never recomputed.
- A guard test fails when a file that influences results changes without a pipeline version decision (`python -m veille_llm.pipeline.version bump patch|minor|major`); the `release` skill and `CLAUDE.md` describe the rule.
- The same article under a second id (arXiv and Hugging Face, a re-published post) is detected by normalised title and never sent to the LLM (`duplicate` status).
- A rejected LLM batch is retried in two halves instead of being lost.

## [0.8.1] - 2026-11-22

### Fixed
- Category consolidation never ran on a big backlog: 14 classification and 6 hook batches used the whole cap of 20, so "Other" stayed at 49% of the catalogue. Consolidation now has its own allowance (3 small calls at most) and no longer waits for spare budget or for every hook to be written.

## [0.8.0] - 2026-11-22

### Added
- Category consolidation: when "Other" holds more than 25% of the 30-day window (at least 10 items), up to 3 LLM calls per run merge tiny or duplicate categories into broader ones and re-home the parked items. The model only proposes; names and ids are validated and the cap of 12 categories is enforced. On the real data, "Other" went from 110 of 194 items to 4.

### Changed
- Categories offered to the LLM are those used inside the 30-day window (an empty category frees its slot), and once the cap of 12 is reached the prompt says so (no new category, pick the closest). Fixes 57% of items landing in "Other".
- The newsletter no longer shows "Other" as a label.

### Fixed
- `make subs-add` and `subs-remove` explain the `EMAIL=` variable when it is missing (passing the address as a bare argument used to give a confusing error).

## [0.7.0] - 2026-11-22

### Added
- Weekly newsletter (`weekly.yml`, `veille-newsletter send`): the 8 best items of the last 7 days (no item, no mail, and no failure), Jinja2 HTML and text mail with the hook in bold, one message per subscriber, sent once per ISO week and resumable after a partial failure (counters only in `veille.db`). Addresses are validated (no header injection), masked in logs and never stored or printed. SMTP over TLS with settings from secrets; the job holding the secrets has read-only repository access, a separate job persists the counters.
- Newsletter safety: SMTP verifies the server certificate and hostname; the connection opens on the first mail only; a refused recipient is skipped without blocking the others; a resume is refused if the subscriber list changed; `--week` must be the current ISO week unless `--dry-run`; `NEWSLETTER_FROM` is validated; URLs with control characters are never linked; future-dated items are never sent; `%` is not allowed in addresses; `subs-push` refuses an empty list and gives gh a `HOME`.
- `make subs-add|subs-remove|subs-list|subs-push` to manage the local `subscribers.txt` and push it to the `SUBSCRIBERS` secret with the personal GitHub account.

## [0.6.0] - 2026-11-22

### Added
- Run progress for GitHub Actions logs: log groups per phase (collect, classify, hooks, export), one line per LLM batch (position, items, tokens, cost, elapsed, eta), a heartbeat line every minute, and a Markdown summary in `GITHUB_STEP_SUMMARY`. Only counts and durations are printed.
- Pre-commit hooks for the web app, limited to staged `web/` files: Biome (format and lint, about 0.1 s), `tsc` with an incremental cache (about 2 s) and Vitest on the related tests only. `npm run check` also runs Biome.

### Changed
- Cards: the title is small and grey, the hook larger and bold, so the two no longer look alike.

### Fixed
- Chip groups are real `fieldset`/`legend` elements (accessibility).

## [0.5.0] - 2026-11-22

### Added
- `web/`: React (Vite, TypeScript, Vitest) catalogue reading `catalogue.json`. Each card shows the hook in bold, then the brief (the raw abstract is gone). Category chips (top 7 by count, rest under "+N more", multi-select), type filter, search, sort (trending, date, score), filters kept in the URL hash, Papier/Nuit themes by system appearance. Source layout by module type: `components/`, `hooks/`, `lib/`, `styles/`. Fixes the display side of #11 and implements #3 and #8.
- Trending sort adds the 0-10 score to upvotes so news (never upvoted) are not buried; stale categories are dropped from the URL; back/forward updates the filters.

### Changed
- The fallback category is "Other" (was "Autres"); existing databases are migrated.
- `daily.yml` builds `web/` (`npm ci --ignore-scripts`, read-only job) and deploys the artifact with the catalogue from a separate job that runs no third-party code; CI also runs the web checks and build, and installs from the lockfiles.
- `make serve` copies `build/catalogue.json` next to the built app.

### Removed
- The v0 page and builder (`site/`, `build.py`, `topics.py`, `veille-llm` command).

## [0.4.1] - 2026-11-22

### Fixed
- A first capped run classified 300 items and published none (empty catalogue): a third of the batch budget is now always kept for hooks, more when many are waiting.

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
