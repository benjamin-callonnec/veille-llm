import json
import urllib.error
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

import pytest

from veille_llm.github import SEED_TOPICS, dynamic_topics, parse_repo
from veille_llm.sources.github_source import github_source, repo_lookup

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)


def raw(name="Owner/Repo", **extra):
    return {
        "full_name": name,
        "html_url": f"https://github.com/{name}",
        "description": "  An MCP server\nfor agents ",
        "stargazers_count": 420,
        "topics": ["mcp", "agents"],
        "owner": {"login": name.split("/")[0]},
        "created_at": "2026-11-10T08:00:00Z",
        "fork": False,
        "archived": False,
        **extra,
    }


def test_parse_repo_builds_a_github_item():
    item = parse_repo(raw())
    assert (item.id, item.source, item.kind, item.title) == (
        "github:owner/repo",
        "github",
        "github",
        "Owner/Repo",
    )
    assert (item.summary, item.url, item.authors) == (
        "An MCP server for agents",
        "https://github.com/Owner/Repo",
        ["Owner"],
    )
    assert (item.published, item.github_stars, item.topics) == (
        "2026-11-10T08:00:00Z",
        420,
        ("mcp", "agents"),
    )


def test_parse_repo_can_date_the_repo_by_the_story_that_found_it():
    assert parse_repo(raw(), published="2026-11-20T00:00:00Z").published == "2026-11-20T00:00:00Z"


@pytest.mark.parametrize(
    "bad",
    [{"fork": True}, {"archived": True}, {"full_name": None}, {"html_url": "javascript:x"}],
)
def test_parse_repo_rejects_forks_archives_and_malformed_repos(bad):
    assert parse_repo(raw(**bad)) is None


def test_dynamic_topics_add_the_most_frequent_topics_seen_twice_after_the_seed():
    counts = {"mcp": 9, "browser-agent": 5, "rag": 2, "once": 1, "evals": 2}
    assert dynamic_topics(counts, seed=("mcp",), limit=4) == [
        "mcp",
        "browser-agent",
        "evals",
        "rag",
    ]


def test_dynamic_topics_never_go_past_the_limit():
    assert dynamic_topics({"x": 3}, limit=3) == list(SEED_TOPICS[:3])


def answers(by_topic, calls):
    def fetch(url):
        calls.append(url)
        q = parse_qs(urlparse(url).query)["q"][0]
        topic = q.split()[0].removeprefix("topic:")
        if topic not in by_topic:
            raise urllib.error.HTTPError(url, 403, "rate limited", {}, None)
        return json.dumps({"items": by_topic[topic]}).encode()

    return fetch


def test_github_source_searches_recent_starred_repos_per_topic_without_duplicates():
    calls = []
    fetch = answers({"mcp": [raw("o/a"), raw("o/b")], "agents": [raw("o/a")]}, calls)
    items = github_source(["mcp", "agents"], fetch=fetch, now=NOW)(7)
    assert [i.id for i in items] == ["github:o/a", "github:o/b"]
    q = parse_qs(urlparse(calls[0]).query)
    assert q["q"] == ["topic:mcp created:>=2026-10-22 stars:>=50 fork:false archived:false"]
    assert (q["sort"], q["order"]) == (["stars"], ["desc"])


def test_github_source_skips_a_failing_topic_but_fails_when_every_topic_fails():
    fetch = answers({"mcp": [raw("o/a")]}, [])
    assert len(github_source(["mcp", "broken"], fetch=fetch, now=NOW)(7)) == 1
    with pytest.raises(urllib.error.HTTPError):
        github_source(["broken"], fetch=fetch, now=NOW)(7)


def test_repo_lookup_fetches_one_repo_and_returns_none_when_it_is_gone():
    def fetch(url):
        if url.endswith("/gone/repo"):
            raise urllib.error.HTTPError(url, 404, "not found", {}, None)
        assert url == "https://api.github.com/repos/o/r"
        return json.dumps(raw("o/r")).encode()

    assert repo_lookup("o/r", "2026-11-20T00:00:00Z", fetch=fetch).published == (
        "2026-11-20T00:00:00Z"
    )
    assert repo_lookup("gone/repo", "2026-11-20T00:00:00Z", fetch=fetch) is None
