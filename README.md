# veille-llm

Personal watch on LLM architecture papers (transformers, alternatives to transformers, LSTM/RNN,
encoder-decoder, LLM agents, knowledge graphs). A Python script pulls the last days of arXiv
(cs.CL, cs.LG, cs.AI), keeps the papers matching the topics in `src/veille_llm/topics.py`, adds the
Hugging Face Papers upvotes, and writes `site/data.json`. The static page in `site/` reads it.

```bash
make install     # uv sync
make unittest
make build       # writes site/data.json (about 35 s: arXiv asks for 3 s between calls)
make serve       # http://localhost:8000
```

## Core pipeline (work in progress)

`veille-core` collects arXiv, Hugging Face and lab blogs, filters them, classifies them with Claude
(Agent SDK, on your subscription, no API key) and exports a catalogue. The v0 site above is not
changed yet.

```bash
env -u ANTHROPIC_API_KEY uv run veille-core run --db build/veille.db --out build/catalogue.json --days 7
```

- Every LLM batch is saved to SQLite as soon as it is done. If the subscription limit is reached
  the command exits with code 1 and keeps what is saved; run it again to resume without
  re-classifying.
- Only classified and categorised items are exported. Items still unclassified after 3 days are
  dropped.
- Categories are proposed by the LLM (12 at most, plus "Autres").
- Design and plans: `docs/superpowers/`.

## Deploy on GitHub Pages

1. Push the repo to GitHub.
2. Settings > Pages > Source: **GitHub Actions**.
3. `.github/workflows/pages.yml` rebuilds and deploys every day at 06:00 UTC, and on each push to `main`.

## Known limits

- Topics are keyword matches on title and abstract, so they are broad (`transformer` also matches
  diffusion transformers) and miss papers that use other words.
- The site only keeps the last 7 days: there is no history yet.
