# Conference section and classification priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the arXiv comment, then (1) classify papers tied to an active conference first in the daily run and (2) add an « Autour de <conférence> » section to the weekly mail.

**Architecture:** `Item.comment` (raw arXiv comment) is stored in `items`. A new pure module `veille_llm/conferences.py` holds the dated calendar and decides which conferences are active and which comment matches. The daily run uses it to reorder pending items and to bypass the keyword prefilter; the newsletter uses it to build sections. `published_items` and `catalogue.json` do not change.

**Tech Stack:** Python 3.13, sqlite3, Jinja2, pytest, ruff, black (see `make check`).

**Spec:** `docs/superpowers/specs/2026-11-27-conference-section-design.md` (issue #49; #50 is out of scope).

## Global Constraints

- Window of a conference: 21 days before `start` to 14 days after `end`, both bounds inclusive, on calendar dates (UTC).
- Section: at most 5 items per conference, no item already in the 8 of the weekly digest, absent when empty. Daily budget unchanged (`DEFAULT_MAX_BATCHES = 20`).
- The mail subject stays the fixed text; the raw arXiv comment never appears in a mail, a log or `catalogue.json`.
- Remote sources, LLM and SMTP are mocked in tests. TDD: failing test first.
- Commit on `develop`, one line `type(scope): subject` of 5 words at most, no trailer, no `--no-verify`, no push. Before each commit: tests of the touched files, then `pre-commit run --files <touched files>`.
- `pipeline/filtering.py` and `pipeline/classify.py` are in `RESULT_FILES`: changing them needs `uv run python -m veille_llm.pipeline.version bump patch` (Task 4). Correction of the spec: a bump is needed, but `patch` never invalidates stored results.

## Review Focus

- arXiv entry without `<arxiv:comment>`, or with an empty one → `comment == ""`, no crash (Task 1).
- Database created before the column existed opens, and old rows read `comment == ""` (Task 2).
- Window bounds: day `start - 21` and `end + 14` are active, one day outside is not; a comment naming last year's edition (`NeurIPS 2025`) never matches the 2026 entry (Task 3).
- A comment matching two active conferences goes to the first in calendar order, deterministically (Task 3).
- No conference active: the mail is byte-identical to today's, and a conference name is the only thing a section adds, never comment text (Task 5).

---

### Task 1: Read the arXiv comment into `Item`

**Files:**
- Modify: `src/veille_llm/arxiv.py` (`Paper`, `parse_feed`), `src/veille_llm/models.py` (`Item`), `src/veille_llm/sources/arxiv_source.py` (`_to_item`)
- Test: `tests/test_sources_parsing.py`, `tests/core/test_sources.py`

**Interfaces:**
- Produces: `Paper.comment: str = ""`, `Item.comment: str = ""` (last field, after `topics`).

- [ ] **Step 1: Write the failing tests.** In `tests/test_sources_parsing.py`: `test_parse_feed_reads_the_arxiv_comment` with a feed entry holding `<arxiv:comment>Accepted at  NeurIPS 2026</arxiv:comment>` (declare `xmlns:arxiv="http://arxiv.org/schemas/atom"` on `<feed>`), asserting `paper.comment == "Accepted at NeurIPS 2026"` (whitespace normalised); and `test_parse_feed_comment_is_empty_when_absent` on the existing `FEED`, asserting `paper.comment == ""`. In `tests/core/test_sources.py`: `test_arxiv_source_keeps_the_comment` asserting the converted `Item.comment` equals the entry's comment.
- [ ] **Step 2: Run them, expect FAIL** (`AttributeError: comment`): `uv run pytest tests/test_sources_parsing.py tests/core/test_sources.py -n0 --no-cov`.
- [ ] **Step 3: Implement.** `Paper` gets `comment: str = ""`; `parse_feed` fills it with `_clean(entry.findtext("{http://arxiv.org/schemas/atom}comment"))`; `Item` gets `comment: str = ""`; `_to_item` passes `comment=paper.comment`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(arxiv): read paper comment`.

### Task 2: Store the comment

**Files:**
- Modify: `src/veille_llm/store.py` (`_ITEM_COLUMNS`, `_ITEM_WIDTH`, `_item`, `_migrate_columns`, `upsert_items`; new `Store.comments`)
- Test: `tests/core/test_store.py`

**Interfaces:**
- Consumes: `Item.comment` (Task 1).
- Produces: `Store.comments(ids: list[str]) -> dict[str, str]` (only non-empty comments; empty input gives `{}`); `Store.pending_classification()` items carry `comment`.

- [ ] **Step 1: Write the failing tests.** `test_comment_round_trips_through_pending_classification` (upsert an `Item(..., comment="ICML 2026 oral")`, read it back from `pending_classification()`); `test_comments_returns_only_non_empty_comments_for_the_ids` (two items, one without comment; `store.comments(["a", "b", "zzz"]) == {"a": "..."}`); `test_a_database_without_the_comment_column_is_migrated` (create the file with sqlite3 using the old `items` schema without `comment`, insert one row, open `Store(path)`, assert `store.comments(["old"]) == {}` and that `pending_classification()` still returns it with `comment == ""`; copy the old DDL from `_SCHEMA` minus the column); `test_catalogue_items_do_not_expose_the_comment` (`published_items` dict has no `"comment"` key).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Add `comment TEXT NOT NULL DEFAULT ''` to `_SCHEMA`'s `items` and to `_migrate_columns`'s `items` list; append `comment` to `_ITEM_COLUMNS`, set `_ITEM_WIDTH = 12`, read `row[11]` in `_item`; add the column to the `INSERT` in `upsert_items` (do not add it to the `ON CONFLICT` update: a known item keeps its row); `published_items` keeps building its dict from named fields, so it needs no change. `comments` is one `SELECT id, comment ... WHERE id IN (...) AND comment != ''`.
- [ ] **Step 4: Run `uv run pytest tests/core/test_store.py tests/core/test_export.py -n0 --no-cov`, expect PASS.**
- [ ] **Step 5: Commit** `feat(store): keep arXiv comment`.

### Task 3: The conference calendar

**Files:**
- Create: `src/veille_llm/conferences.py`, `tests/core/test_conferences.py`

**Interfaces:**
- Consumes: `Item` (with `comment`).
- Produces:
  - `@dataclass(frozen=True) class Conference: name: str; pattern: re.Pattern[str]; start: date; end: date` and `Conference.is_active(day: date) -> bool` (inclusive window `start - 21 d` .. `end + 14 d`).
  - `CONFERENCES: tuple[Conference, ...]`
  - `active(now: datetime, calendar: Sequence[Conference] = CONFERENCES) -> list[Conference]` (calendar order)
  - `conference_of(comment: str, now: datetime, calendar=CONFERENCES) -> Conference | None` (first active conference whose pattern matches)
  - `prioritise(items: list[Item], now: datetime, calendar=CONFERENCES) -> list[Item]` (stable: matching items first, relative order kept)

- [ ] **Step 1: Write the failing tests** (all with a small injected calendar, never the real one): window bounds (`start - 21` active, `start - 22` not, `end + 14` active, `end + 15` not); `conference_of("Accepted at NeurIPS 2026", ...)` returns it, `"NeurIPS 2025"` and `""` return `None`; a comment matching two active entries returns the first one; an inactive conference is never returned even when the comment matches; `prioritise` moves matching items first and keeps the order inside each group; pattern is case-insensitive.
- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement the module.** Patterns are case-insensitive, name plus year (`2026`, `'26`, `26`), no unbounded repetition. Fill `CONFERENCES` for NeurIPS, ICML, ICLR, ACL, EMNLP, CVPR and COLM, for editions whose window is open or opens within 12 months of today (2026-11-27). Dates come from each conference's official site (web search); a date not confirmed gets a `# unverified: <why>` comment on its line.
- [ ] **Step 4: Add `test_the_real_calendar_is_well_formed`:** every `start <= end`, patterns compile, names are unique, no pattern matches the empty string.
- [ ] **Step 5: Run `uv run pytest tests/core/test_conferences.py -n0 --no-cov`, expect PASS.**
- [ ] **Step 6: Commit** `feat(conferences): add dated calendar`.

### Task 4: Daily — prefilter bypass and classification priority

**Files:**
- Modify: `src/veille_llm/pipeline/filtering.py` (`deterministic_filter`), `src/veille_llm/pipeline/classify.py` (`classify_pending`), `src/veille_llm/pipeline/run.py` (the `classify_pending(...)` call near line 213), `src/veille_llm/pipeline/version.py` (via the bump command)
- Test: `tests/core/test_filtering.py`, `tests/core/test_classify.py`, `tests/core/test_run.py`

**Interfaces:**
- Consumes: `conference_of`, `prioritise` (Task 3), `Store.pending_classification()` (Task 2).
- Produces: `classify_pending(..., now: datetime | None = None)`: when `now` is given the pending list goes through `prioritise(pending, now)`; `deterministic_filter` lets a paper through the keyword prefilter when `conference_of(item.comment, now)` is not `None`.

- [ ] **Step 1: Write the failing tests.** Filtering: a paper without keywords and without upvotes is dropped, but kept when its comment names an active conference (the test monkeypatches `veille_llm.conferences.CONFERENCES`, or passes through a module-level calendar in `filtering`; pick the way that needs no new parameter: patch `CONFERENCES`). Classify: with a recording runner (reuse the helper at `tests/core/test_classify.py:94`) and `max_batches=1`, seed `BATCH_SIZE + 3` items where the oldest ones carry a matching comment; with `now` given, those items are in the one batch that runs; without `now`, the order is the old newest-first one. Run: one `test_run.py` case showing that a run with an active conference classifies the matching item although newer items fill the budget.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `classify_pending` reorders only when `now` is not `None`; `run.py` passes `now=now`; the filter bypass is one extra condition on the existing `item.kind == "paper" and item.upvotes < MIN_UPVOTES` line.
- [ ] **Step 4: Bump:** `uv run python -m veille_llm.pipeline.version bump patch`, then `uv run pytest tests/core -n0 --no-cov`, expect PASS (including `test_version.py`).
- [ ] **Step 5: Commit** `feat(pipeline): prioritise conference papers`.

### Task 5: Weekly mail — conference sections

**Files:**
- Modify: `src/veille_llm/newsletter/select.py`, `src/veille_llm/newsletter/render.py`, `src/veille_llm/newsletter/send.py`, `src/veille_llm/newsletter/templates/newsletter.html.j2`, `src/veille_llm/newsletter/templates/newsletter.txt.j2`
- Test: `tests/newsletter/test_select.py`, `tests/newsletter/test_render.py` (create if absent), `tests/newsletter/test_send.py`

**Interfaces:**
- Consumes: `Store.comments` (Task 2), `conference_of`, `active` (Task 3), the existing `select_items`.
- Produces:
  - `SECTION_ITEMS = 5`
  - `@dataclass(frozen=True) class Section: conference: str; items: list[dict]`
  - `select_sections(store: Store, now: datetime, *, exclude: set[str], days: int = 7, limit: int = SECTION_ITEMS, calendar=CONFERENCES) -> list[Section]` (one section per active conference with at least one item; items of the week, best score first, as `select_items` orders them; an item goes to the first matching conference only)
  - `render(items, *, week, contact, now, sections: Sequence[Section] = ())` (default keeps current callers valid)

- [ ] **Step 1: Write the failing tests.** Select: a matching item outside the weekly top 8 appears in its section; a matching item already in `exclude` does not; no active conference or no matching item gives `[]`; at most 5 items; an item matching two conferences appears once. Render: with `sections=[]` the HTML and text are byte-identical to the output of the same call before this task (assert against a rendered string kept in the test); with one section the text and HTML contain `Around NeurIPS 2026` (English like the rest of the mail), the items' hooks, and not the raw comment; a hostile conference name is escaped in HTML. Send: `send_newsletter` calls `select_sections` with `exclude` set to the ids of the 8 items, and a dry run writes a file containing the section.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `select_sections` builds on `select_items(store, now, days=days, limit=10_000)`, drops `exclude`, reads `store.comments(ids)`, groups by `conference_of(comment, now, calendar)`, cuts at `limit`. Templates: one block per section after the main list, same card markup as items, a heading `Around {{ section.conference }}`; no block when `sections` is empty. `send.py` computes `sections` after `items` and passes them to `render`.
- [ ] **Step 4: Run `uv run pytest tests/newsletter -n0 --no-cov`, expect PASS.**
- [ ] **Step 5: Commit** `feat(newsletter): add conference sections`.

### Task 6: Spec upkeep, measurement and full check

**Files:**
- Modify: `docs/superpowers/specs/2026-11-27-conference-section-design.md`

- [x] **Step 1: Fix the spec** to match the plan: module path is `src/veille_llm/conferences.py` (shared by pipeline and newsletter, not under `newsletter/`), and a `patch` pipeline bump is needed (replace « pas de décision de version »).
- [ ] **Step 2: Measure** the share of arXiv papers whose comment is filled: one throwaway command, fetching one page of the real feed with `veille_llm.arxiv.parse_feed(_fetch_page(0, 200))` and counting non-empty `comment` and those matched by `conference_of`. Do not commit it; report the numbers in the issue #49 as a comment.
- [ ] **Step 3: Full check** once: `make check`, expect green with 100% of what the repo enforces.
- [ ] **Step 4: Commit** `docs(conferences): align design`.

## Self-review

- Spec coverage: collection (T1, T2), calendar and window (T3), daily priority and prefilter (T4), section (T5), `ALTER` migration (T2), unverified dates and the sample measurement (T3, T6), limits (spec only). Out of scope: #50.
- Types: `Item.comment`, `Store.comments`, `conference_of`, `prioritise`, `Section`, `select_sections` are named identically in every task that uses them.
