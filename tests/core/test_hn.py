import json

from veille_llm.hn import Story, parse_stories, route_stories
from veille_llm.models import Mention
from veille_llm.sources.hn_source import hn_stories

WHEN = "2026-11-20T10:00:00Z"
EPOCH = 1795168800  # WHEN as a Unix timestamp


def hit(object_id="1", url="https://blog.example.com/post", points=150, **extra):
    return {
        "objectID": object_id,
        "title": f"Story {object_id}",
        "url": url,
        "points": points,
        "author": "pg",
        "created_at_i": EPOCH,
        **extra,
    }


def story(object_id="1", url="https://blog.example.com/post", points=150):
    return Story(object_id, f"Story {object_id}", url, points, "pg", WHEN)


def discussion(object_id):
    return f"https://news.ycombinator.com/item?id={object_id}"


def test_parse_stories_reads_the_hits():
    assert parse_stories({"hits": [hit()]}) == [story()]


def test_parse_stories_skips_hits_without_id_title_or_date():
    hits = [hit(objectID=None), hit(title=""), hit(created_at_i="soon"), hit("ok")]
    assert [s.id for s in parse_stories({"hits": hits})] == ["ok"]


def test_a_text_post_without_url_points_to_its_discussion():
    (only,) = parse_stories({"hits": [hit("7", url=None)]})
    assert only.url == discussion("7")


def test_a_plain_story_is_news_with_its_own_discussion_as_mention():
    routed = route_stories([story("1")])
    (news,) = routed.news
    assert (news.id, news.kind, news.source, news.url) == (
        "hn:1",
        "news",
        "hackernews",
        "https://blog.example.com/post",
    )
    assert routed.mentions == [Mention("hn:1", discussion("1"), "Story 1", 150, WHEN)]
    assert routed.repos == {}


def test_a_story_about_a_repo_is_a_mention_on_that_repo_never_news():
    routed = route_stories([story("2", "https://github.com/Owner/Repo.git/tree/main")])
    assert routed.news == []
    assert routed.mentions == [Mention("github:owner/repo", discussion("2"), "Story 2", 150, WHEN)]
    assert routed.repos == {"owner/repo": WHEN}


def test_github_pages_that_are_not_repos_stay_news():
    routed = route_stories([story("3", "https://github.com/features/copilot")])
    assert [n.id for n in routed.news] == ["hn:3"] and routed.repos == {}


def test_a_story_about_an_arxiv_paper_is_a_mention_on_the_paper():
    routed = route_stories([story("4", "https://arxiv.org/pdf/2511.01234v2.pdf")])
    assert routed.news == []
    assert routed.mentions == [Mention("arxiv:2511.01234", discussion("4"), "Story 4", 150, WHEN)]


def test_the_repo_date_is_its_first_story():
    early = Story("5", "A", "https://github.com/o/r", 100, "pg", "2026-11-19T00:00:00Z")
    routed = route_stories([story("6", "https://github.com/o/r"), early])
    assert routed.repos == {"o/r": "2026-11-19T00:00:00Z"}


def test_hn_stories_asks_for_stories_above_the_points_over_at_most_two_days():
    asked = []

    def fetch(url):
        asked.append(url)
        return json.dumps({"hits": [hit()]}).encode()

    assert hn_stories(7, now=EPOCH, fetch=fetch, min_points=100) == [story()]
    (url,) = asked
    assert "tags=story" in url
    assert "points%3E%3D100" in url
    assert f"created_at_i%3E{EPOCH - 2 * 86400}" in url


def test_only_valid_owner_and_repo_names_count_as_repos():
    for url in [
        "https://github.com/../etc",
        "https://github.com/o/%2e%2e",
        "https://github.com/o/a b",
    ]:
        assert route_stories([story("8", url)]).repos == {}
