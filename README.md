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
items of the last 7 days to each subscriber, one message per address, once per ISO week. Under 3
items it sends nothing and fails, so GitHub e-mails the author. The delivery counters (counts
only, never addresses) live in `veille.db` on the `data` branch; a rerun after a partial failure
resumes where it stopped.

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

## Deploy on GitHub Pages

1. Push the repo to GitHub.
2. Settings > Pages > Source: **GitHub Actions**.
3. `.github/workflows/daily.yml` runs every day at 06:00 UTC (or by hand): pipeline, then build of `web/` and deploy.

## Known limits

- The catalogue keeps the items of the last 30 days exported by the pipeline.
- Categories are proposed by the LLM, so they can change from one day to the next.
