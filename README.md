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

## Deploy on GitHub Pages

1. Push the repo to GitHub.
2. Settings > Pages > Source: **GitHub Actions**.
3. `.github/workflows/pages.yml` rebuilds and deploys every day at 06:00 UTC, and on each push to `main`.

## Known limits

- Topics are keyword matches on title and abstract, so they are broad (`transformer` also matches
  diffusion transformers) and miss papers that use other words.
- The site only keeps the last 7 days: there is no history yet.
