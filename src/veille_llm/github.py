"""GitHub repositories in the LLM agents / harnesses domain: parsing and topic choice."""

from __future__ import annotations

from veille_llm.hf import as_count
from veille_llm.models import Item

# The domain of the GitHub section. The LLM still rejects off-domain repos (games, Java...).
SEED_TOPICS: tuple[str, ...] = (
    "mcp",
    "model-context-protocol",
    "claude-code",
    "agent-skills",
    "claude-skills",
    "coding-agent",
    "llm-agent",
    "ai-agents",
    "agentic-ai",
    "agent-framework",
)
WINDOW_DAYS = 30  # a repo stays a candidate for a month after its creation
MAX_TOPICS = 15  # the Search API allows 30 requests a minute with a token
MIN_TOPIC_COUNT = 2  # a topic seen on a single published repo is not a trend yet


def dynamic_topics(
    counts: dict[str, int], *, seed: tuple[str, ...] = SEED_TOPICS, limit: int = MAX_TOPICS
) -> list[str]:
    """The seed, then the topics most seen on the published repos, up to the limit."""
    learned = sorted(
        (t for t, n in counts.items() if n >= MIN_TOPIC_COUNT and t not in seed),
        key=lambda t: (-counts[t], t),
    )
    return [*seed, *learned][:limit]


def parse_repo(raw: dict, published: str | None = None) -> Item | None:
    """A repo from the GitHub API, or None for a fork, an archive or a malformed payload."""
    name, url, created = raw.get("full_name"), raw.get("html_url"), raw.get("created_at")
    if raw.get("fork") or raw.get("archived"):
        return None
    if not isinstance(name, str) or name.count("/") != 1 or not isinstance(created, str):
        return None
    if not isinstance(url, str) or not url.startswith("https://github.com/"):
        return None
    topics = raw.get("topics")
    return Item(
        id=f"github:{name.lower()}",
        source="github",
        kind="github",
        title=name,
        summary=" ".join(str(raw.get("description") or "").split())[:2000],
        url=url,
        authors=[name.split("/")[0]],
        published=published or created,
        github_stars=as_count(raw.get("stargazers_count")),
        topics=tuple(t for t in topics if isinstance(t, str)) if isinstance(topics, list) else (),
    )
