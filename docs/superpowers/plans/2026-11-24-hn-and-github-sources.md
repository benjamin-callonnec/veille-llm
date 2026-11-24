# Hacker News and GitHub trending sources (#47)

Two new sources. Hacker News stories are collected like arXiv, with no topic filter. GitHub
repositories in the LLM agents / harnesses domain get their own catalogue section (type
`github`). HN stories that point to a repository or an arXiv paper become witness articles
("mentions") on that item instead of duplicate news.

## Decisions (from the issue and the author)

- GitHub discovery: Search API by topic, repos created in the last 30 days, sorted by stars,
  no forks or archived repos. Stars are refreshed every run. Growth and sparklines come later.
- Topics: a small seed list in code plus the most frequent topics of the published `github`
  items (capped). The LLM rejects anything out of the agents / harnesses domain.
- HN: Algolia `search_by_date`, stories with at least `MIN_POINTS` points over the last 2 days.
  No keyword filter: the LLM decides.
- HN routing: a story that points to `github.com/<owner>/<repo>` is a mention on
  `github:<owner>/<repo>`, and that repo is fetched if the topic search missed it (discovery).
  A story that points to an arXiv paper is a mention on `arxiv:<id>`. Every other story is a
  `news` item, with its own discussion as its mention.
- Still open: a repo seen before that takes off again is not re-surfaced in v1 (its stars are
  refreshed, nothing more).

## Data shape

- `Item.topics: tuple[str, ...]` (GitHub topics; empty elsewhere), stored as JSON.
- `Mention(item_id, url, title, points, published)`: table `mentions`, key `(item_id, url)`,
  points only ever raised. No foreign key: a mention can wait for its paper.
- `catalogue.json`: each item gets `mentions: [{title, url, points}]`, most points first.
- GitHub item: id `github:<owner>/<repo>` (lower case), source `github`, kind `github`, title
  `owner/repo`, summary = description, published = discovery date (search) or the HN story date
  (discovery), `github_stars`, `topics`.

## Tasks

- [x] 1. Store: `topics` column, `mentions` table, `save_mentions`, `topic_counts`, mentions in
  the export, stars refreshed for every collected item.
- [x] 2. `hn.py` (pure): `Story`, `parse_stories`, `route_stories` -> news items, mentions, repos
  to look up; a story about an article collected in the same run is a mention on it.
  `sources/hn_source.py`: fetch with retry.
- [x] 3. `github.py` (pure): `parse_repo`, `dynamic_topics` (seed + learned topics, generic ones stopped).
  `sources/github_source.py`: topic search and single-repo lookup, token from `GITHUB_TOKEN`.
- [x] 4. Pipeline: HN and GitHub wired into `run_pipeline` and `main`; repos dated by discovery,
  so `deterministic_filter` is unchanged; classification forces type `github` on repos and states
  the domain; pipeline version bump.
- [x] 5. Workflow: `GITHUB_TOKEN` passed to the pipeline step.
- [x] 6. Front: type `github`, `mentions` parsed and shown on the card.

## Not in scope

Star growth history and sparklines, re-surfacing old repos, HN comments, favourites (#48).
