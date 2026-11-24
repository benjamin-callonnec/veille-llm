"""Hacker News stories: parsed once where they come in, then routed to the item they are about."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import NamedTuple
from urllib.parse import urlparse

from veille_llm.hf import as_count
from veille_llm.models import Item, Mention

SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date"
_STAMP = "%Y-%m-%dT%H:%M:%SZ"
# github.com/<first>/... pages that are not repositories.
_NOT_OWNERS = {
    "about", "apps", "collections", "enterprise", "events", "explore", "features", "login",
    "marketplace", "orgs", "pricing", "search", "settings", "sponsors", "topics", "trending",
}  # fmt: skip
# shortcut: new-style arXiv ids only; old ones (cs/0101001) stay news, rare on HN today.
_ARXIV_PATH = re.compile(r"^/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/?$")


class Story(NamedTuple):
    id: str
    title: str
    url: str  # the link, or the discussion for a text post
    points: int
    author: str
    published: str


class Routed(NamedTuple):
    news: list[Item]
    mentions: list[Mention]
    repos: dict[str, str]  # "owner/repo" -> date of its first story, to look the repo up


def discussion_url(story_id: str) -> str:
    return f"https://news.ycombinator.com/item?id={story_id}"


def parse_stories(payload: dict) -> list[Story]:
    stories = []
    for hit in payload.get("hits", []):
        story_id, title, stamp = hit.get("objectID"), hit.get("title"), hit.get("created_at_i")
        if not story_id or not title or not isinstance(stamp, int):
            continue
        stories.append(
            Story(
                id=str(story_id),
                title=" ".join(str(title).split()),
                url=hit.get("url") or discussion_url(str(story_id)),
                points=as_count(hit.get("points")),
                author=str(hit.get("author") or ""),
                published=datetime.fromtimestamp(stamp, UTC).strftime(_STAMP),
            )
        )
    return stories


def repo_of(url: str) -> str | None:
    """'owner/repo' for a github.com repository link, else None."""
    parsed = urlparse(url)
    if parsed.hostname not in ("github.com", "www.github.com"):
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2 or parts[0].lower() in _NOT_OWNERS:
        return None
    return f"{parts[0]}/{parts[1].removesuffix('.git')}".lower()


def arxiv_of(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.hostname not in ("arxiv.org", "www.arxiv.org"):
        return None
    match = _ARXIV_PATH.match(parsed.path)
    return match.group(1) if match else None


def route_stories(stories: list[Story]) -> Routed:
    """A story about a repo or a paper is a mention on it; any other story is news."""
    routed = Routed([], [], {})
    for s in stories:
        repo, paper = repo_of(s.url), arxiv_of(s.url)
        if repo:
            target = f"github:{repo}"
            routed.repos[repo] = min(s.published, routed.repos.get(repo, s.published))
        elif paper:
            target = f"arxiv:{paper}"
        else:
            target = f"hn:{s.id}"
            routed.news.append(
                Item(target, "hackernews", "news", s.title, "", s.url, [s.author], s.published)
            )
        routed.mentions.append(
            Mention(target, discussion_url(s.id), s.title, s.points, s.published)
        )
    return routed
