# Reader viewer and panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF viewer with zoom, search, outline and keyboard navigation, persistent highlights, a selection box with a question field, and resizable/collapsible PDF | chat panes (#21).

**Architecture:** pdf.js sits behind a small `PdfSource` interface so everything above it is testable in jsdom with a fake source. Pure functions own selection→quote, page windowing, anchors and pane state. Highlights persist through three new routes in the `veille_reader` server (migration 2). The right pane is a placeholder that lists asked questions until #22.

**Tech Stack:** React 18, Vite, Vitest, Biome, `pdfjs-dist` (exact version pinned at install: the latest at least two weeks old, loaded by dynamic import); FastAPI, SQLite.

**Spec:** `docs/superpowers/specs/2026-11-22-reader-viewer-design.md` (mockups validated by the author: layout A, selection box with question field, colour dots yellow/green/red, Copy).

## Global Constraints

- Layout A: two panes PDF | chat, about 60/40, drag handle, one collapse button per pane (reading only, chat only), highlights in a collapsible strip under the PDF, Papier and Nuit themes through the existing CSS tokens.
- Selection box: text field (placeholder `Ask about this passage…`, Enter sends, Escape closes), three colour dots `yellow` `green` `red` (highlight without asking, no fixed meaning), `Copy`. Sending a question highlights the passage in yellow.
- Highlight colours are exactly `yellow`, `green`, `red`. Rectangles are stored normalised (0 to 1 of the page width and height), so they survive zoom changes.
- pdf.js: PDF scripting off, `isEvalSupported: false`, links from the PDF only if `http` or `https`. Paper text is data: rendered as text, never as HTML.
- Keyboard: PageUp/PageDown and arrows move, `+` and `-` zoom, `/` opens search, `Escape` closes the selection box or the search.
- Pane state and zoom persist in `localStorage` with try/catch; the page works when storage is unavailable.
- Server routes keep the existing guards (local Host, same-origin); nothing is written outside the reader data dir.
- The public Pages build must still not contain `reader.html` or the viewer code. No secrets, no subscriber data. `veille_reader` is not in `RESULT_FILES`.
- TDD: failing test first. Python line length 100; Biome for web. pdf.js is always mocked in tests.

## Review Focus

- A 300 or more page PDF: pages rendered at once stay bounded, scrolling does not leak canvases.
- A selection spanning two pages or two columns, or an empty or whitespace-only selection: a sensible quote, or no box.
- Highlight rectangles after zoom changes and after reload: same place on the page.
- Hostile PDF content: `javascript:` link annotations, text containing `<script>` or markup, huge text layers.
- A password-protected, corrupt or non-PDF response: a clear error, not a blank page.
- `localStorage` unavailable or holding garbage: defaults, no crash.
- Deleting a highlight that does not exist, or posting a highlight for an unknown item or invalid colour: 404 or 422, nothing stored.

---

### Task 1: Highlights storage and API

**Files:**
- Modify: `src/veille_reader/storage.py` (migration 2, store methods), `src/veille_reader/server.py` (routes)
- Test: `tests/reader/test_storage.py`, `tests/reader/test_server.py`

**Interfaces:**
- Produces: migration 2 creating `highlights(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, page INTEGER NOT NULL, color TEXT NOT NULL, text TEXT NOT NULL, rects TEXT NOT NULL, created_at TEXT NOT NULL)` with an index on `item_id`; `ReaderStore.add_highlight(item_id: str, page: int, color: str, text: str, rects: list[list[float]]) -> int`, `ReaderStore.highlights(item_id: str) -> list[dict]` (keys `id, page, color, text, rects, created_at`, ordered by page then id), `ReaderStore.delete_highlight(item_id: str, highlight_id: int) -> bool`. Routes: `GET /api/items/{id}/highlights` → list; `POST /api/items/{id}/highlights` body `{page, color, text, rects}` → 201 with the stored highlight; `DELETE /api/items/{id}/highlights/{hid}` → 204 or 404. Rect = `[x, y, w, h]`, floats in 0..1.

- [ ] **Step 1: Write failing tests**: migration 2 applies on a version-1 database without losing `papers` rows; add/list/delete round trip, ordering, deleting a missing id returns False; server: POST then GET returns it, DELETE removes it, unknown item 404, colour not in the three values 422, `page < 1` 422, more than 200 rects or any value outside 0..1 422, text longer than 5000 characters 422, cross-site POST refused (403), DELETE of another item's highlight id 404.
- [ ] **Step 2: Run** `uv run pytest tests/reader -q --no-cov`. Expected: FAIL.
- [ ] **Step 3: Implement** storage methods and routes (pydantic model for validation).
- [ ] **Step 4: Run** the same command plus `uv run ruff check src tests`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(reader): highlights storage and API`.

### Task 2: Pure helpers (quote, page window, anchors, pane state)

**Files:**
- Create: `web/src/reader/lib/quote.ts`, `web/src/reader/lib/pages.ts`, `web/src/reader/lib/anchor.ts`, `web/src/reader/lib/panes.ts`
- Test: `web/src/reader/lib/*.test.ts`

**Interfaces:**
- Produces:
  - `quote.ts`: `type Rect = [number, number, number, number]`; `interface Quote { text: string; page: number; rects: Rect[] }`; `toQuote(page: number, text: string, clientRects: {x:number;y:number;width:number;height:number}[], pageBox: {x:number;y:number;width:number;height:number}): Quote | null` (normalises rects to the page box, clamps to 0..1, drops zero-size rects, collapses whitespace in text, returns null for empty text); `toPixelRects(rects: Rect[], width: number, height: number)`.
  - `pages.ts`: `visibleWindow(scrollTop: number, viewportHeight: number, pageHeights: number[], gap: number, overscan: number): {first: number; last: number}` (0-based, inclusive, covers viewport plus `overscan` pages each side, clamped); `pageOffsets(pageHeights: number[], gap: number): number[]`.
  - `anchor.ts`: `parseHash(hash: string): {item: string; page: number | null}`; `writeHash(item: string, page: number | null): string` (page only when ≥ 1).
  - `panes.ts`: `interface PaneState { ratio: number; pdfCollapsed: boolean; chatCollapsed: boolean }`; `DEFAULT_PANES = { ratio: 0.6, pdfCollapsed: false, chatCollapsed: false }`; `clampRatio(r: number): number` (0.25..0.8); `togglePdf(s)`, `toggleChat(s)` (collapsing one while the other is collapsed expands the other, never both collapsed); `nudge(s, delta)`; `loadPanes(storage: Pick<Storage,"getItem"> | null): PaneState` and `savePanes(storage: Pick<Storage,"setItem"> | null, s: PaneState): void` tolerating missing storage, throwing storage and invalid JSON.

- [ ] **Step 1: Write failing tests**: quote normalisation at two page sizes gives identical rects, empty or whitespace-only text gives null, rects outside the page are clamped, zero-size rects are dropped; 300 pages of 800 px: window length stays ≤ viewport pages + 2×overscan + 1 at top, middle and bottom, and never leaves 0..299; `parseHash` of `#item=a&page=3`, `#item=a`, `#item=a&page=0`, `#item=a&page=x`; `writeHash` round trip; pane clamp, collapse rules (never both collapsed), `loadPanes` with null storage, throwing getItem, garbage JSON and out-of-range ratio returns defaults or clamped values.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/lib`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules (no React, no DOM).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): reader helpers for quotes, page windows, anchors and panes`.

### Task 3: Pane layout component

**Files:**
- Create: `web/src/reader/PaneLayout.tsx`, `web/src/reader/PaneLayout.test.tsx`, `web/src/styles/reader.css` (imported by `web/src/reader/main.tsx`)

**Interfaces:**
- Consumes: `panes.ts` (Task 2).
- Produces: `PaneLayout({ pdf, chat, storage }: { pdf: ReactNode; chat: ReactNode; storage?: Storage | null })`: header buttons "Hide PDF" / "Show PDF" and "Hide chat" / "Show chat" (accessible names), a separator element `role="separator"` with `aria-orientation="vertical"`, `aria-valuenow` (percent), focusable, ArrowLeft/ArrowRight move it by 2 points, pointer drag updates the ratio; state saved with `savePanes` on change and loaded with `loadPanes` on mount.

- [ ] **Step 1: Write failing tests**: renders both panes at 60%; "Hide chat" leaves only the PDF and the button becomes "Show chat"; hiding the second pane while the first is hidden shows the first again; ArrowRight/ArrowLeft on the separator change `aria-valuenow` and clamp at 25 and 80; a pointer drag across a mocked 1000 px container sets the ratio; state restored from a pre-filled fake storage; no crash when `storage` is null or throws.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/PaneLayout.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and the layout CSS using the existing tokens (Papier and Nuit, no new colours except highlight colours defined as tokens `--hl-yellow`, `--hl-green`, `--hl-red` for both themes in `tokens.css`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): resizable and collapsible reader panes`.

### Task 4: PdfSource and the viewer

**Files:**
- Modify: `web/package.json` (+ lockfile: `pdfjs-dist` exact pinned version, `npm install --save-exact --ignore-scripts`)
- Create: `web/src/reader/pdf/source.ts`, `web/src/reader/pdf/pdfjsSource.ts`, `web/src/reader/pdf/fakeSource.ts` (test helper, only imported by tests), `web/src/reader/PdfViewer.tsx`, `web/src/reader/PdfViewer.test.tsx`

**Interfaces:**
- Produces:
  - `source.ts`: `interface PageInfo { width: number; height: number }` (at scale 1); `interface PdfSource { numPages: number; pageInfo(page: number): Promise<PageInfo>; render(page: number, canvas: HTMLCanvasElement, scale: number): Promise<void>; textLayer(page: number): Promise<{ text: string; boxes: {text: string; x: number; y: number; width: number; height: number}[] }>; outline(): Promise<{ title: string; page: number }[]>; destroy(): void }` (page numbers 1-based, `boxes` in scale-1 page coordinates); `openPdf(url: string): Promise<PdfSource>` rejecting with `PdfOpenError` carrying `reason: "password" | "invalid" | "network"`.
  - `pdfjsSource.ts`: the pdf.js implementation of `openPdf` (dynamic `import("pdfjs-dist")`, worker via Vite `?url`, scripting disabled, `isEvalSupported: false`, `enableXfa: false`).
  - `PdfViewer({ source, page, onPageChange, onSelection, highlights }: { source: PdfSource; page: number; onPageChange(p: number): void; onSelection(sel: { quote: Quote; anchor: { x: number; y: number } } | null): void; highlights: { id: number; page: number; color: string; rects: Rect[] }[] })` with a toolbar (page number input, zoom out/in, zoom percent), zoom 50–300 % persisted, only pages in `visibleWindow` render a canvas and a text layer (others are sized empty placeholders), canvases released when leaving the window, keyboard handling per the constraints, `scrollToPage` through the `page` prop, highlight rectangles drawn with `toPixelRects`.

- [ ] **Step 1: Write failing tests** with a `FakeSource` (N pages, canvas rendering recorded, no real drawing): with 300 pages only a bounded number of `render` calls are active and canvases are released after scrolling far; zoom buttons and `+`/`-` change scale and persist; PageDown/PageUp and typing a page number call `onPageChange`; changing the `page` prop scrolls to that page; selecting text in a text-layer span calls `onSelection` with a `Quote` in normalised rects; clearing the selection calls `onSelection(null)`; highlight rects render as elements with the colour class at the right percent positions; text containing `<script>` appears as text; `openPdf` mapping tested separately with a mocked `pdfjs-dist`: password error → `reason: "password"`, invalid → `"invalid"`, and PDF scripting and `isEvalSupported` options are passed as required; link annotations with `javascript:` are not rendered as links (only `http`/`https`).
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader`. Expected: FAIL.
- [ ] **Step 3: Implement** the interface, the pdf.js adapter (the only file importing `pdfjs-dist`) and `PdfViewer`.
- [ ] **Step 4: Run** `cd web && npm run check`, then `VITE_READER_URL=http://127.0.0.1:8765 npx vite build --mode reader` and confirm the default `npx vite build` still produces no `reader.html` and no pdf.js chunk. Expected: green, and the default build is unchanged.
- [ ] **Step 5: Commit** `feat(web): PDF viewer on pdf.js behind a testable source`.

### Task 5: Search and outline

**Files:**
- Create: `web/src/reader/lib/search.ts`, `web/src/reader/lib/search.test.ts`, `web/src/reader/SearchBar.tsx`, `web/src/reader/OutlineMenu.tsx`, `web/src/reader/SearchBar.test.tsx`
- Modify: `web/src/reader/PdfViewer.tsx` (host the two controls and `/` shortcut)

**Interfaces:**
- Consumes: `PdfSource.textLayer`, `PdfSource.outline`.
- Produces: `findAll(pages: {page: number; text: string}[], query: string): {page: number; start: number; end: number; snippet: string}[]` (case-insensitive, whitespace-normalised, empty query returns none, at most 500 hits); `SearchBar({ source, onGo }: { source: PdfSource; onGo(page: number): void })` scanning pages lazily in the background with a "n of m" counter, Enter/Shift+Enter next/previous, Escape closes; `OutlineMenu({ source, onGo })` listing outline entries (empty outline shows nothing).

- [ ] **Step 1: Write failing tests**: `findAll` cases (case, accents untouched, overlapping, empty, cap at 500, snippet trimmed); SearchBar finds hits across a fake 20-page source, counter text, Enter moves to the next hit and calls `onGo` with its page, Escape closes, a page whose text fails to load is skipped; OutlineMenu lists entries and calls `onGo`, renders nothing for an empty outline, escapes a title with markup.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules; scanning yields to the event loop every few pages.
- [ ] **Step 4: Run** `cd web && npx vitest run src/reader`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): reader search and outline`.

### Task 6: Selection box, highlights strip and question list

**Files:**
- Create: `web/src/reader/SelectionBox.tsx`, `web/src/reader/HighlightsStrip.tsx`, `web/src/reader/QuestionList.tsx`, `web/src/reader/useHighlights.ts`, and a test file for each
- Modify: `web/src/reader/ReaderPage.tsx` (integration), `web/src/reader/ReaderPage.test.tsx`

**Interfaces:**
- Consumes: `Quote`, `PaneLayout`, `PdfViewer`, highlight routes (Task 1), `openPdf`.
- Produces: `useHighlights(itemId: string, api?: HighlightsApi)` returning `{ highlights, add(page, color, text, rects), remove(id), error }` where `HighlightsApi = { list(item): Promise<Highlight[]>; add(item, body): Promise<Highlight>; remove(item, id): Promise<void> }` (default implementation uses `fetch` on the routes); `SelectionBox({ quote, anchor, onAsk, onHighlight, onCopy, onClose })` (field with placeholder `Ask about this passage…`, Enter calls `onAsk(question)` only for non-empty text, three colour buttons with accessible names "Highlight yellow/green/red", Copy button, Escape calls `onClose`); `HighlightsStrip({ highlights, onGo, onRemove })` collapsible under the PDF, filter by colour, click to jump, each row shows page and text; `QuestionList({ questions })` placeholder chat pane listing `{ quote, question }` with the quote's page and a "↗" button that calls `onGo(page)`.

- [ ] **Step 1: Write failing tests**: SelectionBox: Enter with text calls `onAsk` once, Enter with empty or whitespace text does nothing, colour buttons call `onHighlight` with the right colour, Copy writes the quote text to a mocked clipboard, Escape closes; `useHighlights` loads, adds and removes through a fake API and reports errors without throwing; HighlightsStrip: list, filter by colour, jump and delete; QuestionList: shows quote, page and question as text (markup escaped) and "↗" jumps; ReaderPage with a fake `openPdf` and fake API: selecting text shows the box, sending a question adds a yellow highlight and a question entry, a highlight created by a colour dot appears in the strip and survives a remount from the fake API, the page in the URL hash updates on page change and is applied on load, a password-protected PDF and a non-PDF response each show a clear error message and no blank page.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader`. Expected: FAIL.
- [ ] **Step 3: Implement** the components, `useHighlights`, and the integration (PdfViewer inside PaneLayout, strip under the PDF, QuestionList as the chat pane).
- [ ] **Step 4: Run** `cd web && npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): selection box, highlights and question list in the reader`.

### Task 7: Docs, full check and manual verification

**Files:**
- Modify: `README.md` (Reader section: viewer, shortcuts, highlights stored in `reader.db`), `.claude/CLAUDE.md` only if architecture lines change, `tests/harness/test_ci_web.py` (assert the default build contains no `pdf` worker or `reader` assets)

- [ ] **Step 1: Write the failing harness test**: the default `vite build` output directory contains no file whose name contains `pdf.worker` or `reader`. Run `uv run pytest tests/harness -q --no-cov`. Expected: passes only once the viewer is excluded from the default build; fix imports if it fails.
- [ ] **Step 2: Update the README** reader section.
- [ ] **Step 3: Run** `make check`. Expected: all green.
- [ ] **Step 4: Manual verification** (state clearly what was and was not verified): `make reader` with a real catalogue, open an arXiv paper, check scrolling, zoom, search, outline, selecting text, asking a question, the three colours, Copy, reload keeps highlights and page, pane drag and collapse, Papier and Nuit.
- [ ] **Step 5: Commit** `docs(reader): viewer docs and build guard`. Then the independent opus review and the `release` skill, as for #20.
