# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).
Each merge of `develop` into `main` gets a version (see `.claude/skills/release`).

## [Unreleased]

## [0.21.2] - 2026-11-25

### Fixed
- Reader chat: while an answer streams, the conversation no longer jumps back to the bottom if you scrolled up to keep reading. It follows the stream only when you are at the bottom, and resumes when you send a message, start a quiz or open a conversation.

## [0.21.1] - 2026-11-24

### Changed
- Catalogue (#48): the Favorites chip sits in the same row as Paper, News, Benchmark and GitHub (local reader build only).

## [0.21.0] - 2026-11-24

### Added
- Reader (#48): favorites, kept locally in `.local/reader/`. A star on every card of the local catalogue (papers, news, benchmarks, GitHub repos) and a Favorites filter (`fav=1` in the address) show only the saved items. A favorite that has left the catalogue still shows, from the copy saved when it was added. In the reader, a star next to the title and the `S` key add or remove the paper (listed in the shortcuts panel). The public catalogue on GitHub Pages has neither star nor filter.

## [0.20.0] - 2026-11-24

### Added
- Sources (#47): Hacker News stories (Algolia API, at least 100 points over the last two days, no topic filter: the LLM decides). A story about a GitHub repo, an arXiv paper or an article already collected becomes a discussion attached to that item; every other story is a news item.
- Catalogue (#47): a new GitHub section for repos about LLM agents and harnesses (MCP servers, skills, coding agents...). Repos created in the last 30 days are searched by topic and sorted by stars, which are refreshed every run. The topics are a seed list plus the topics most seen on published repos (generic ones like python or llm are never learned). A repo shared on Hacker News joins even when the search missed it, and the LLM rejects anything outside the domain.
- Catalogue (#47): each card lists its top three Hacker News discussions with their points.

### Changed
- Pipeline version 1.1.1: classification knows repositories (always typed `github`, kept only within the agents domain), so stored verdicts are recomputed gradually.
- The daily workflow gives the pipeline the read-only workflow token for the GitHub Search API.

## [0.19.0] - 2026-11-23

### Added
- Reader (#45): the placeholder of the empty composer is now alive. With next questions recommended by the tutor, it shows them one after the other (6 s, short fade; Tab fills the one shown). Without any, it goes through a static list of tips (`web/src/reader/lib/tips.ts`, one line per tip: shortcuts, the `/` menu, images, reports, citations, highlights, dictation, session memory, quiz, export...) and the invitation "Ask about the paper…", in a random order drawn again for each round, never twice the same text in a row. A tip about a feature that is not there (no skill, no report, no microphone) is never shown. Nothing rotates while you type, while the tutor answers, with `prefers-reduced-motion` (the invitation stays) or with a single recommendation.

## [0.18.0] - 2026-11-23

### Added
- Reader (#43): clicking a citation of a report opens a preview of the paper on the right of the viewer: the whole page, at a readable size, scrolled to the cited passage and highlighted, with zoom (50 to 300 %), previous and next page, and an icon to open the PDF at that place. The page looks like the PDF pane (backdrop, shadow, dark-theme inversion, accent highlight).
- Reader (#43): when a citation gives no exact quote (a page only, or a quote not found), the preview highlights the closest passage to the text of the slide, dashed and marked "Closest match: not an exact quote"; when nothing is close enough it says so instead of showing a wrong passage.
- Reader (#43): a citation shows only `[p.N]` in the viewer and in the exported file; the quote stays hidden and is only used to find the passage. Citations a report builds after it loaded are picked up too.
- Reader (#43): the `/present` skill asks as many questions as it needs (audience, depth, length as a time or a size, focus, what to leave out, tone), always includes a diagram or a chart when the paper has something to draw, makes slides clean but never empty (bullets, two columns, a big number, a chart or a diagram), lets you move with a click on the right or the left half of the screen, and cites with exact quotes. It gets more room (20 turns, 1 $, 30 tool calls) when you invoke it with `/present`; a limit you configured yourself is respected.
- Reader (#43): two new sub-skills, `charts` and `diagrams`, give the rules for a readable chart or architecture diagram as inline SVG (title, legend, labels, units, scale); `write_report` tells the agent what to fix (an SVG without title or viewBox, an image without alt text) and ignores decorative SVGs.
- Reader (#43): a quiet reports icon in the chat header reopens the viewer; `V` opens and closes it and the page keeps the slide you were on; the PDF toolbar only shows when the mouse reaches the top edge; the viewer bar has icons for export and full screen; the `/` menu is a quiet list of names with a card for the highlighted skill.
- Reader (#44): while the agent works, three dots make a wave before "Thinking" (they rest while it waits for your answer), and a timer in the corner of the message counts the whole answer, then keeps the final duration.

### Fixed
- Reader (#43): `V` and `Esc` typed inside a report close the viewer; a hidden viewer no longer opens previews or steals the keyboard; the captions of figures are asked again after a failure; regenerating an answer keeps the skill you invoked.

## [0.17.0] - 2026-11-23

### Added
- Reader (#43): agent skills. A skill is a Markdown file (`skills/*.md`: name, description, tools, prompt). The tutor sees only the names and descriptions and loads one with `use_skill`, or you invoke it with `/name` from the composer's slash menu (read only). `write_report` and `read_report` refuse to act until a skill that lists them is loaded. No skill, no change in behaviour.
- Reader (#43): skills are published as `skills.zip` on the `skills` GitHub release by the new `skills.yml` workflow (it validates every skill first) and pulled at startup into `.local/reader/skills/` (a disposable cache; a failed pull keeps the cache).
- Reader (#43): HTML reports written by the tutor, kept locally (never in git) with one version per write (50 kept), restore of an old version and export as a standalone HTML file. A generic file viewer (`V` opens and closes it) shows them in a sandboxed iframe (scripts allowed, no network, no same origin).
- Reader (#43): the `/present` skill asks for the audience, depth, length and focus, then writes an HTML presentation of the paper.

### Fixed
- Reader (#43): regenerating an answer keeps the skill you invoked with `/name`.

## [0.16.0] - 2026-11-23

### Added
- Trending (#42): the GitHub stars of the repo Hugging Face links to a paper are read with the upvotes (one call), kept in the database (never lowered), exported as `github_stars`, shown on the card and added to the trending sort on a log scale. The classification filter is unchanged.
- Reader (#41): in the dark themes (forced or from the system) the PDF pages are inverted (`--pdf-filter`), with no re-render; the text layer and the highlights are untouched. Raster images are inverted too (keeping them intact was left out).
- Shortcut: `H` goes back to the home page (the catalogue) from any page, not while typing and not with a modifier. It is listed in the settings panel.

### Fixed
- Counts read from Hugging Face (upvotes, stars) go through `int()` as before and are never negative.

## [0.15.0] - 2026-11-23

### Added
- Scheduling (#38): a Cloudflare Worker (`scheduler/`) now starts `daily.yml` (every day 06:00 UTC) and `weekly.yml` (Monday 08:00 UTC) on time with `workflow_dispatch` on `main`, because GitHub's own crons started hours late. It retries transient errors, never retries a 401, 403, 404 or 422, fails visibly on an unknown cron or a missing token, and never logs the token. Local run: `make scheduler-dev`.
- Infrastructure (#38): Terraform (`iac/`, state on R2) owns the cron triggers; `wrangler` deploys the code. One-time setup, the repo-specific tokens, their rotation and the `.env.cloudflare` file are in `setup/README.md`; `make tf-*`, `make scheduler-deploy` and `make scheduler-secret` load that file and name any missing variable.
- CI (#38): the Worker is checked by `make check`, Terraform is validated without credentials, and a deploy job (Worker, then crons) runs on `main` only after every other gate, never cancelled half way.
- Alert (#38): `freshness.yml` fails, so GitHub emails you, when no `daily` run succeeded in the last 30 hours (Worker stopped, token expired).

### Changed
- `daily.yml` and `weekly.yml` no longer have a `schedule:`: they run only by `workflow_dispatch` (the Worker, or by hand). Do not put the schedules back: two schedulers would run the LLM twice.
- `spike-llm.yml` runs only from `main` (the Worker's GitHub token can dispatch any workflow on any branch).

## [0.14.1] - 2026-11-23

### Fixed
- Reader (#30): a figure or table found late (the first look at the structure of a paper takes about a second) no longer overrides what you did meanwhile: another citation, a highlight, the page field, a scroll to another page or another paper.
- Reader (#30): a stored structure that is not valid JSON or does not fit is extracted again and replaced, instead of ending in a server error.

## [0.14.0] - 2026-11-23

### Added
- Reader (#30): going back to a place in the PDF now lands on the exact spot: the box is scrolled to a third of the view (never above the top of its page) and flashed. It works from a highlight row, the quote of an *ask the agent* question and the agent's citations, and falls back to the page when no position is known.
- Reader (#30): the structure of a paper (text lines with their position, sections, figure and table captions) is extracted once with `pdfminer.six`, stored in `reader.db` and served by `GET /api/items/<id>/structure`. A paper it cannot read simply has none: the reader works as before.
- Reader (#30): the tutor can cite a figure or a table, `[p.N Figure K]` or `[p.N Table K]` (also `Figure 3.1` for chapter-numbered papers); the citation chip brings you to the caption.
- Adds `pdfminer.six` to the reader dependencies.

## [0.13.1] - 2026-11-23

### Fixed
- Read aloud while streaming: text is held back while a link, image, inline math or inline code is still open, so stripping the markdown when it closes can no longer shift the reading position (no repeated or skipped sentences).
- Read aloud: the browser utterance is kept referenced until it ends, so Chrome can no longer collect it mid-sentence and leave the reading stuck.
- Dictation: a phrase the browser delivers after the message was sent (or after you typed) is ignored, so it no longer reappears in the composer or marks the next typed message as dictated.
- Memory panel: a failed load message disappears after a later successful load, and an older, slower response can no longer overwrite a newer one.
- Regenerate also drops, in the open conversation, the question cards and note lines that sat just before the replaced answer (as the server does).
- Auto read aloud: the start is idempotent, so React StrictMode's double mount no longer stops a reading that began while the answer streamed.
- `make reader`: the ports are variables (`READER_PORT`, `FRONT_PORT`) shared by the port check and the commands, and the front URL follows `FRONT_PORT`.
- Voice socket: a speech replaced by another with the same id no longer unregisters its replacement (cancel works), synthesis runs off the event loop and an engine crash sends an error frame instead of a lost task error, and an over-long utterance no longer floods the client with errors.

## [0.13.0] - 2026-11-23

### Added
- Voice (#26): dictate into the composer with a quiet microphone icon (browser speech recognition, push to talk, live phrase, editable result, asked only on click, clear message if blocked) and read answers aloud with a speaker icon, sentence by sentence while they stream, with stop and replay; citations, markdown and code are not spoken.
- Voice (#26): the answer to a dictated message is read aloud by default (a typed message keeps a silent answer); the speaker icon still stops and replays it.
- Settings: a reading speed for the voice, slow (0.8×), normal or fast (1.3×), remembered in the browser and applied from the next sentence.
- A local `/api/voice` WebSocket (loopback and same origin only, size and rate limits, no audio on disk) with an engine interface for a future local model, and a reconnecting client. Not used by the UI yet; see `docs/superpowers/specs/2026-11-23-reader-voice-design.md` for what is real and the evaluation of whisper.cpp and piper. Adds the `websockets` library to the reader dependencies.
- `ask_user` tool (#29): the tutor can pause a turn to ask you one short question (free text or up to 4 options, 2 per answer, 2 minutes to reply). A card appears in the chat, your reply goes back to the model as escaped data, an expired card lets the turn carry on without an answer, and the card is stored (answered or expired) so a reload shows it. New stream events `ask_user` and `ask_resolved`, and the route `POST /api/items/<id>/conversations/<cid>/asks/<ask>/answer`.
- Chat tools (#29): a session memory panel (notes with who wrote each one, edit, delete, add), a turn trace panel (tools, tokens, cache tokens, time, cost), a quiet line when the tutor saves or removes a note, the summary behind the compaction note, and an arrow icon to continue once with the raised limit when the conversation budget is reached.

### Changed
- A conversation refused for its budget says it can be raised once; regenerate takes `raise_limit`.
- `pypdf` is pinned below 7.1 (7.0.1, 13 days old) instead of the 4-day-old 7.1.1.

### Fixed
- Asking again a question that was just refused no longer stores it twice.
- The 30-note limit is checked and the note inserted in one statement, so two writes cannot exceed it.
- Cache read and write tokens are kept in the trace.
- `make reader` checks ports 8765 and 5173 first and names the leftover process; pdf.js and katex are split into their own chunks (no more chunk-size warning).

## [0.12.0] - 2026-11-23

### Added
- The tutor can read the paper (#23, part of #17): three local read-only tools, `load_artifact` (pages, a section, the references, a figure or a table, your highlights), `search_paper` and `session_memory`, served through the Agent SDK with the built-in tools off. The PDF text is extracted with `pypdf` and cached; everything a tool returns is an escaped data block.
- Session memory per paper: short notes (30 at most, 500 characters each) the tutor writes and always sees, which you can list, add, edit and delete through the API.
- Limiters: per answer 12 tool calls (6 per tool, 15 s each), 8 model turns and 0.50 USD; per conversation 3.00 USD, raisable once. A limit shows as a clear message, a tool that fails or times out is reported to the model and never stops the answer.
- Compaction: a long conversation has its old turns summarised (small model, no tool) while the last 4 exchanges and the notes are kept, never cutting an exchange in half; a quiet note in the chat says so.
- The session budget counts what every answer cost, taken from the trace: an answer that hits a limit still counts and regenerating cannot erase it. Notes record who wrote them (you or the tutor).
- A local trace of every turn (tools with their duration and errors, tokens, cost, model; never the text), readable through the API.
- Grounded citations (#31): the tutor cites `[p.N "short exact quote"]`; each quote is verified against the page text (verified, found on another page, not found, page only) with its section, sent with the answer and stored. Chips show doubtful citations dashed with a tooltip, and a click goes to the page and flashes the quote in the PDF.
- `search_paper` is a local ranked search (BM25 over section-aware passages, exact phrases first) instead of an exact substring match.
- `make eval-reader`: 10 questions on two papers run through the real tutor, with page precision and recall, verified quotes, facts, abstention, tool calls, cost and time.
- The ask-the-agent box next to a selection is one quiet pill with three real-coloured dots (visible in the dark theme), copy and send icons, and it stays on screen. Copy is an icon.
- A new conversation has its own compose icon in the chat corner; the composer's "+" is kept for attachments and audio.
- Composer (#24): paste or drop images and screenshots (up to 4 per message, 5 MB each, PNG, JPEG, WebP or GIF checked by content) with removable thumbnails, large images scaled down in the browser, shown in your message (click opens the full image). Images are stored locally, served only to the local reader, and sent to the tutor as image blocks; text inside an image is treated as data.
- After each answer the tutor offers up to 3 suggested follow-up questions (validated, one click to send); suggestions containing `[placeholders]` fill the composer and Tab jumps from one placeholder to the next. Drafts are kept per conversation.
- Eval: page recall counts a case as found when any of its valid pages is cited; the tutor now says so, without citing, when the paper does not answer.
- The highlights drawn on the page keep their light colours in the dark theme.
- Quizzes (#25): a "Quiz me" icon (or just ask the tutor) makes a question from the paper, multiple choice or free answer. Each question is validated, grounded in a verified quote and page, and the right answer and explanation stay on the server until you reply. A free answer is graded against the paper with the reasoning shown. Scores are kept per paper and per quiz, and a wrong answer leaves a note in the session memory so the tutor revisits it.
- The highlights list is redone in the chat's quiet style (#35): a discreet highlighter icon with the count, then plain rows (colour dot, page, passage in the normal text colour, readable in both themes) with copy and delete icons on hover. Clicking a row still goes to the top of its page; going to the exact place waits for the bounding-box work (#30).
- Suggested prompts: the first one is the composer's placeholder (Tab fills it in, Enter sends), the others stay buttons in the chat. A quiz card always answers for the paper of the chat.
- Quiz formats: single choice and true/false answer on click, multiple choice has checkboxes and a right-arrow icon that appears once something is ticked, fill-in-the-blank and put-in-order are graded on the server without the model, and the free answer stays graded by the model. "Quiz me" mixes the formats. Answer failures now say why (already answered shows the result).

### Changed
- Icons instead of text for the PDF search, the outline, the pane controls and the settings gear (#27). On narrow screens (under 640 px) the PDF and the chat stack and long words wrap. The colour dots are darker in the Papier theme (contrast of at least 3:1).
- A budget refusal (per answer or per conversation) shows its own message instead of the subscription-limit text. A failed quiz start leaves a quiet note, not a tutor message.
- Images over 5 MB are accepted when scaling brings them under the limit; the cap applies to what is sent.
- The search index of a paper is built once and reused across turns; citations are checked once per answer, off the event loop.

### Fixed
- Retry works after a quiz card or a failed quiz; two quiz starts at once make one quiz.
- Quotes from pages with `&`, `<` or `>` are verified (the text the tutor sees is escaped, the quote is unescaped before the check).
- Dropping a non-image file on the composer no longer opens the file over the app.
- Suggested prompts are hidden while a quiz starts; the quiz maker avoids every earlier question of the paper, answered or not; `load_artifact` for a figure or a table without a number says a number is needed.

## [0.11.0] - 2026-11-22

### Added
- Reader PDF viewer (#21, part of #17): a pdf.js viewer (pinned `pdfjs-dist`, scripting and eval off, PDF links never rendered) with zoom, search (`/`), outline, keyboard navigation and a bounded number of rendered pages, so a 300-page PDF stays responsive. The page is kept in the URL.
- Selection box next to a selected passage: a question field (Enter), three highlight colours (yellow, green, red) and Copy. Highlights are stored per paper in the local database (routes `GET/POST/DELETE /api/items/{id}/highlights`, migration 2) and listed under the PDF with jump-to and filter.
- Two panes, PDF | chat, resizable by dragging or with the arrow keys and collapsible: a small cross collapses a pane (a thin "+" rail brings it back) and **Cmd/Ctrl+B** and **Cmd/Ctrl+J** toggle the PDF and the chat (B and J are not taken by Chrome; the variants with Shift or Alt are left alone). The layout is remembered.
- Reader chat core (#22): a streaming chat with the tutor. Answers stream token by token (stop and regenerate), your questions about a passage appear as a quote with its page and a "p.N" link back to the PDF, `[p.N]` citations in answers scroll the PDF, Markdown and math are rendered safely (raw HTML as text, only http(s) links, no remote images). Conversations are kept per paper (new, rename, delete, export to Markdown).
- The chat looks like Claude's own: your question in a quiet neutral bubble, the answer as plain text across the pane (inline code, bullets, blue links), and every control is an icon with a tooltip instead of a text button. At rest nothing shows under the messages; hovering your question shows its day, retry and copy, hovering an answer shows copy and how long ago it was written. The composer is one big rounded pill: the text, then a send arrow only once you have typed something, or a stop square while it answers; the model that answers is shown quietly under it. The conversations (switch, rename, export, delete) sit behind one "⋯" icon in the corner, and everything shares one icon set.
- A discreet "Thinking" line above each answer (no box, transparent): open while the agent works, folded automatically when the answer starts, reopenable at any time, also from history. It shows the reasoning and, later, the tools with their inputs.
- Server side of the chat: conversations and messages (migration 3), a streaming endpoint (SSE) with a pluggable agent runner, and a Claude Agent SDK runner on your subscription (no API key, no tools, summarized thinking, Sonnet by default, `VEILLE_READER_MODEL` to change). Stopping keeps the partial answer. The tutor only sees the title, summary and selected passage until #23 adds tools.
- A long-lived Claude token for the chat: `make reader-token` saves the token from `claude setup-token` to `.env` (git-ignored, mode 600, hidden input, never printed); the reader loads `CLAUDE_CODE_OAUTH_TOKEN` from the environment or from that file (only that key, never a variable that bills per token). `make reader` states which login it uses, a permissive `.env` triggers a warning, and an expired session shows a clear message in the chat.
- A shared app shell (`AppShell`) so every page has the same chrome without rendering it: the logo (home button to the catalogue) in the top-left corner of the page and a floating settings gear in the bottom-left corner. The gear opens the settings: theme (Auto follows the system, Papier light, Nuit dark; remembered) and the keyboard shortcuts of the page; `?` opens it too. On the catalogue, `/` jumps to the search box.
- The keyboard shortcuts follow your keyboard: on a Mac they show ⌘ (Command), Return, ⇧ and fn with an arrow for PageUp/PageDown; on Windows and Linux they show Ctrl, Enter, Shift, PageUp and PageDown.
- A logo for the web app: the "Lw" monogram in a rounded square, coloured by the Papier / Nuit theme, used as the favicon, the home button and, with the title on the same line, the head of every page.
- Paper cards open the reader when you click anywhere on the card, for every item with an arXiv PDF (papers and benchmarks); the title still opens the original article in a new tab.
- Local workflow: `make reader` runs the API and the front with auto-reload (API restarts on Python changes, the front hot-reloads with Vite on `127.0.0.1:5173`, the API port redirects there), rebuilds the static front at each start, and removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX` for its own processes (the reader refuses them otherwise). `make reader-build` keeps the single-process, no-reload mode. `make catalogue` downloads the published catalogue (with hooks and briefs) into `build/catalogue.json` safely, and `make reader` runs it when the file is missing.

### Fixed
- Local reader (follow-ups of 0.10.0): a catalogue whose items are not a list is rejected, the server picks up a regenerated catalogue, default paths are anchored at the repo root instead of the current directory, and the IPv6 literal is no longer accepted as a local host.

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
