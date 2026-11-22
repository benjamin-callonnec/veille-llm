# veille-llm

Personal watch on LLM research and news. A daily GitHub Actions pipeline collects arXiv, Hugging
Face Papers and lab blogs, filters them, has Claude classify them and write a short hook and brief
for each (Agent SDK on a Claude subscription, no API key), and publishes a React catalogue on
GitHub Pages.

```bash
make install     # uv sync + npm ci (web/)
make check       # ruff, pytest, tsc and vitest
make serve       # builds web/, copies build/catalogue.json next to it, serves http://localhost:8000
```

## Core pipeline

`veille-core` collects arXiv, Hugging Face and lab blogs, filters them, classifies them with Claude
(Agent SDK, on your subscription, no API key) and exports a catalogue.

```bash
env -u ANTHROPIC_API_KEY uv run veille-core run --db build/veille.db --out build/catalogue.json --days 7
```

- Every LLM batch is saved to SQLite as soon as it is done. If the subscription limit is reached
  the command exits with code 1 and keeps what is saved; run it again to resume without
  re-classifying.
- Only classified and categorised items are exported. Items still unclassified after 3 days are
  dropped.
- Categories are proposed by the LLM (12 at most, plus "Other").
- Design and plans: `docs/superpowers/`.

## Newsletter

Every Monday 08:00 UTC `weekly.yml` sends the same mail (Jinja2, HTML and text) with the 8 best
items of the last 7 days to each subscriber, one message per address, once per ISO week. With no
interesting item it sends nothing (and does not fail). The delivery counters (counts
only, never addresses) live in `veille.db` on the `data` branch; a rerun after a partial failure
resumes where it stopped. If a `weekly` run goes red, use "Re-run failed jobs", not "Re-run all jobs": the counters are saved by the `persist` job, and a full rerun after a successful send would mail everyone again.

```bash
make subs-add EMAIL=friend@example.org   # edits the local, gitignored subscribers.txt
make subs-remove EMAIL=friend@example.org
make subs-list
make subs-push                           # gh secret set SUBSCRIBERS (personal account)
uv run veille-newsletter send --db build/veille.db --dry-run   # renders build/newsletter.html
```

Secrets to create in the repository settings: `SUBSCRIBERS`, `SMTP_HOST`, `SMTP_PORT` (587
STARTTLS or 465), `SMTP_USER`, `SMTP_PASSWORD` (an app password), `NEWSLETTER_FROM` (for example
`LLM watch <you@example.org>`) and `NEWSLETTER_CONTACT` (the address people write to to
unsubscribe). Nothing private is stored in the repository.

## Reader (local only)

`make reader` starts the local reader with **auto-reload**: the API (`veille-reader serve --reload`,
`127.0.0.1:8765`) restarts when a Python file changes and the front (Vite, `127.0.0.1:5173`)
hot-reloads. Open `http://127.0.0.1:5173`; it needs `build/catalogue.json`. The reader answers on your
Claude subscription, so `make reader` removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX` for its own processes only
(your shell keeps them). `make reader-build` builds the front once and serves everything from the API
server, without reload. A paper opens in `reader.html#item=<id>` with a "Read" link on paper cards; its
arXiv PDF is fetched from arxiv.org on first use and cached in `.local/reader/pdfs/` (gitignored, never
redistributed). Highlights, chats and scores live in `.local/reader/reader.db`. The public Pages build never
contains the reader or the "Read" link. If port 8765 is taken (an older reader still running), stop it first.
Panes: drag the divider (or use the arrow keys when it is focused), collapse a pane with its small cross
or toggle with **Alt+1** (PDF) and **Alt+2** (chat); a thin rail with a "+" brings it back.

The page shows the PDF (zoom, search with `/`, outline, PageUp/PageDown) next to a pane for the
chat; the divider can be dragged (or moved with the arrow keys) and each pane collapsed. Select a
passage to get a small box: type a question about it (Enter), or pick a colour to highlight it, or
copy it. Highlights are kept in `reader.db` and the page number stays in the URL. The tutor chat
chat is a streaming conversation with the tutor (Agent SDK on your subscription, no API key, no
tools yet): answers stream token by token, a discreet "Thinking" line shows the reasoning (open while
the agent works, folded when the answer starts, reopenable any time), `[p.N]` citations scroll the PDF,
conversations are kept per paper (dropdown in the chat header: new, rename, delete, export to
Markdown). The tutor uses Sonnet by default (`VEILLE_READER_MODEL` to change it) and, for now, only sees
the title, summary and the passage you selected, not the full text (tools come with #23).
Remaining pieces: #23 to #26 (parent: #17).

## Deploy on GitHub Pages

1. Push the repo to GitHub.
2. Settings > Pages > Source: **GitHub Actions**.
3. `.github/workflows/daily.yml` runs every day at 06:00 UTC (or by hand): pipeline, then build of `web/` and deploy.

## Known limits

- The catalogue keeps the items of the last 30 days exported by the pipeline.
- Categories are proposed by the LLM, so they can change from one day to the next.
