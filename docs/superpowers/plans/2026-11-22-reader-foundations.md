# Reader foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local reader module base (#20): local server, versioned local storage, arXiv PDF cache, a reader page opened from a "Read" button on catalogue cards (local build only).

**Architecture:** New Python package `veille_reader` (FastAPI, bound to 127.0.0.1) next to `veille_llm`, with its own data dir. The front is a second Vite entry (`web/reader.html`) sharing theme tokens with the catalogue; it is included in a build only with `VITE_READER=1`.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, httpx (tests), SQLite; React 18, Vite, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-22-reader-foundations-design.md`

## Global Constraints

- Server listens on `127.0.0.1` only; default port `8765`; requests whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (any port) get 403.
- Data dir default `.local/reader/` (already gitignored); holds `reader.db` and `pdfs/`. Nothing is written outside it.
- PDF only for `arxiv.org/abs/<id>` or `/pdf/<id>` URLs; download host `arxiv.org` only; max 50 MiB; first bytes must be `%PDF`; network timeout 30 s; cached file name derived from the validated id only.
- Schema versioned with `PRAGMA user_version`; migration 1 creates only table `papers(item_id TEXT PRIMARY KEY, pdf_file TEXT NOT NULL, fetched_at TEXT NOT NULL)`.
- "Read" button: paper-type cards only, only when `VITE_READER_URL` is set at build. The Pages build sets neither `VITE_READER_URL` nor `VITE_READER`.
- Remote sources are always mocked in tests. No secret or subscriber data anywhere. `veille_reader` is not in `RESULT_FILES` (no pipeline version bump).
- TDD: failing test first, `ruff` line length 100, Biome for web.

## Review Focus

- arXiv id edge cases: old-style ids (`hep-th/9901001`), versions (`2401.01234v3`), trailing slash or query string, `..` or `%2e%2e` in the id: never escape `pdfs/`.
- A catalogue item whose URL is on a lookalike host (`arxiv.org.evil.com`, `evilarxiv.org`): no PDF, no download.
- Redirect from arxiv.org to another host during download: refused.
- Concurrent first requests for the same item: one valid cached file, never a half-written file served.
- Missing or malformed `build/catalogue.json`: clear error at startup or 404 per item, never a crash loop.

---

### Task 1: Local storage with migrations

**Files:**
- Create: `src/veille_reader/__init__.py`, `src/veille_reader/storage.py`
- Test: `tests/reader/__init__.py`, `tests/reader/test_storage.py`
- Modify: `pyproject.toml` (add `src/veille_reader` to wheel packages; dependency group `reader = ["fastapi>=0.115", "uvicorn>=0.30", "httpx>=0.27"]`, appended to `default-groups`; script `veille-reader = "veille_reader.cli:main"`; coverage `--cov=veille_reader` in addopts)

**Interfaces:**
- Produces: `MIGRATIONS: list[str]` (one SQL script per version); `class ReaderStore` with `__init__(self, data_dir: Path)` (creates `data_dir` and `data_dir/pdfs`, opens `data_dir/reader.db`, migrates), `pdfs_dir: Path`, `schema_version() -> int`, `record_pdf(item_id: str, pdf_file: str) -> None`, `pdf_file(item_id: str) -> str | None`, `close() -> None`. Raises `StorageError` if the db version is newer than `len(MIGRATIONS)`.

- [ ] **Step 1: Write failing tests** in `tests/reader/test_storage.py`: `test_fresh_dir_is_migrated_to_latest` (version == `len(MIGRATIONS)`, `pdfs/` exists); `test_reopen_does_not_rerun_migrations` (record a pdf, reopen, row still there); `test_newer_database_is_refused` (set `PRAGMA user_version = 99` by hand, expect `StorageError`); `test_record_and_read_pdf_file`; `test_nothing_written_outside_data_dir` (use `tmp_path / "data"`, assert `tmp_path` contains only `data`).
- [ ] **Step 2: Run** `uv sync && uv run pytest tests/reader/test_storage.py -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `ReaderStore` and `StorageError` in `storage.py`; apply each pending migration inside a transaction and bump `user_version` after it.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reader): versioned local storage`.

### Task 2: PDF resolution and cache

**Files:**
- Create: `src/veille_reader/pdf.py`
- Test: `tests/reader/test_pdf.py`

**Interfaces:**
- Consumes: `ReaderStore` (Task 1).
- Produces: `arxiv_id(url: str) -> str | None` (valid id or None); `pdf_url(arxiv_id: str) -> str` (`https://arxiv.org/pdf/<id>`); `Fetcher = Callable[[str], bytes]`; `class PdfError(Exception)` with a `reason` str (`"no_pdf"`, `"too_large"`, `"not_pdf"`, `"fetch_failed"`); `default_fetcher(url: str) -> bytes` (urllib, 30 s timeout, redirects only to `arxiv.org` over https, reads at most 50 MiB + 1 byte); `ensure_pdf(store: ReaderStore, item_id: str, item_url: str, fetch: Fetcher = default_fetcher) -> Path`.

- [ ] **Step 1: Write failing tests**: `arxiv_id` accepts `https://arxiv.org/abs/2401.01234`, `.../abs/2401.01234v3`, `.../pdf/2401.01234v2`, `.../abs/hep-th/9901001`, `.../abs/2401.01234/` ; rejects `https://arxiv.org.evil.com/abs/2401.01234`, `https://evilarxiv.org/abs/2401.01234`, `http://arxiv.org/abs/...` is accepted only as https (reject http), `.../abs/../../etc/passwd`, `.../abs/%2e%2e/x`, a non-arXiv blog URL. `ensure_pdf`: downloads once and reuses the cache (fetcher called once for two calls); raises `PdfError("no_pdf")` for a non-arXiv URL without calling the fetcher; `"too_large"` when the fetcher returns more than 50 MiB; `"not_pdf"` when bytes do not start with `%PDF`; `"fetch_failed"` when the fetcher raises; the file lands in `store.pdfs_dir` with a name derived from the id (slashes replaced by `_`) and nothing else is written; a failed download leaves no partial file; two threads calling `ensure_pdf` at once for one item leave one valid file (write to a temp name in `pdfs_dir`, then `os.replace`).
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_pdf.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `pdf.py`. Id grammar: new style `\d{4}\.\d{4,5}(v\d+)?`, old style `[a-z\-]+(\.[A-Z]{2})?/\d{7}(v\d+)?`, full-match on the path after `/abs/` or `/pdf/` (one optional trailing slash, strip a trailing `.pdf`); host must equal `arxiv.org` exactly, scheme `https`, query and fragment ignored.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reader): arXiv PDF resolution and local cache`.

### Task 3: Local server and CLI

**Files:**
- Create: `src/veille_reader/server.py`, `src/veille_reader/cli.py`
- Test: `tests/reader/test_server.py`, `tests/reader/test_cli.py`

**Interfaces:**
- Consumes: `ReaderStore`, `ensure_pdf`, `PdfError`, `Fetcher`.
- Produces: `create_app(data_dir: Path, catalogue_path: Path, static_dir: Path | None = None, fetch: Fetcher = default_fetcher) -> FastAPI`; routes `GET /api/health` → `{"status": "ok"}`; `GET /api/items/{item_id}` → `{"id", "title", "hook", "url", "type", "has_pdf"}` or 404; `GET /api/items/{item_id}/pdf` → `application/pdf` bytes, 404 `{"reason": "no_pdf"}` when no arXiv PDF, 502 `{"reason": ...}` when the fetch fails; static files served at `/` when `static_dir` is given; also serves `catalogue.json` from `catalogue_path` at `/catalogue.json`. `main(argv: list[str] | None = None) -> int` with `serve --data-dir .local/reader --catalogue build/catalogue.json --static web/dist --port 8765`.

- [ ] **Step 1: Write failing tests** with `fastapi.testclient.TestClient` and a fake fetcher: health ok; known item metadata with `has_pdf` true for an arXiv item and false for a blog item; unknown id 404; pdf endpoint returns the fake bytes with `application/pdf` and calls the fetcher once over two requests; blog item pdf 404 with `reason == "no_pdf"`; fetcher failure gives 502; `Host: evil.example` gives 403 (and `localhost:8765` is accepted); an item id like `../../x` or `%2e%2e` gives 404 and never touches the filesystem outside `data_dir`; missing catalogue file or invalid JSON: `create_app` raises `ValueError` with a clear message; `/catalogue.json` is served. CLI: `main(["serve", ...])` calls an injected runner with host `127.0.0.1` and the given port (patch `uvicorn.run`); the host is not configurable.
- [ ] **Step 2: Run** `uv run pytest tests/reader -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `server.py` (load catalogue once into a dict by id, Host check as middleware) and `cli.py`.
- [ ] **Step 4: Run** `uv run pytest tests/reader -v` then `uv run ruff check src tests && uv run ruff format --check src tests`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(reader): local server, PDF endpoint and CLI`.

### Task 4: Front: shared tokens, reader page and Read button

**Files:**
- Create: `web/reader.html`, `web/src/reader/main.tsx`, `web/src/reader/ReaderPage.tsx`, `web/src/reader/ReaderPage.test.tsx`, `web/src/styles/tokens.css`, `web/src/styles/reader.css`
- Modify: `web/src/styles/styles.css` (move the `:root` theme blocks to `tokens.css`, import it), `web/src/components/Card.tsx`, `web/src/components/App.test.tsx` (or a new `Card.test.tsx`), `web/vite.config.ts`, `web/src/lib/catalogue.ts` (export `readerUrl(itemId: string, base: string | undefined): string | null`)

**Interfaces:**
- Consumes: server routes from Task 3.
- Produces: `ReaderPage({ itemId, load }: { itemId: string; load?: (id: string) => Promise<ReaderItem> })` where `ReaderItem = { id; title; hook; url; type; has_pdf }`, showing title, hook, and either "PDF available" or "No PDF for this item", an error line for unknown items; `Card` shows a "Read" link (`rel="noopener noreferrer"`, same tab off) only for `type === "paper"` when `import.meta.env.VITE_READER_URL` is non-empty, href `<base>/reader.html#item=<encodeURIComponent(id)>`.

- [ ] **Step 1: Write failing tests**: `readerUrl` returns null without base, trims a trailing slash, encodes ids; Card renders the Read link only for papers with the env set (use `vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765")`) and renders none for news or without the env; ReaderPage shows title and hook and "PDF available" for a loaded item, "No PDF for this item" when `has_pdf` is false, an error message when `load` rejects, and escapes a title containing `<script>` (rendered as text).
- [ ] **Step 2: Run** `cd web && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** the components; `main.tsx` reads `item` from `location.hash`; `vite.config.ts` adds `build.rollupOptions.input = { main: "index.html", ...(process.env.VITE_READER ? { reader: "reader.html" } : {}) }`; theme tokens move unchanged to `tokens.css`.
- [ ] **Step 4: Run** `cd web && npm run check` and a default `npm run build` then confirm `dist/reader.html` does not exist; run `VITE_READER=1 VITE_READER_URL=http://127.0.0.1:8765 npm run build` and confirm it does. Expected: all green.
- [ ] **Step 5: Commit** `feat(web): reader page and Read button (local build only)`.

### Task 5: Make target, docs, full check

**Files:**
- Modify: `Makefile` (target `reader`), `.claude/CLAUDE.md` (architecture line and the local-only rule), `README.md` (short "Reader (local)" section), `tests/harness/test_ci_web.py` only if it asserts on the Makefile or the Vite build (keep Pages build free of `reader.html`)
- Test: add one test in `tests/harness/test_ci_web.py` asserting `daily.yml` never sets `VITE_READER` or `VITE_READER_URL`.

- [ ] **Step 1: Write the failing harness test** for the workflow, run `uv run pytest tests/harness -v`. Expected: it passes if no workflow sets the variables; also assert `Makefile` has a `reader` target (fails first).
- [ ] **Step 2: Implement** `make reader`: build web with `VITE_READER=1 VITE_READER_URL=http://127.0.0.1:8765`, then `uv run veille-reader serve`; document it.
- [ ] **Step 3: Run** `make check`. Expected: all green.
- [ ] **Step 4: Manual smoke test**: `make reader` with a real `build/catalogue.json`; open a paper's "Read" link, confirm the page and `GET /api/items/<id>/pdf` returns a PDF and creates a file under `.local/reader/pdfs/`; report what was or was not verified.
- [ ] **Step 5: Commit** `docs(reader): make target and docs`. Then the independent opus review and the `release` skill, as for earlier plans.
