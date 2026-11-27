import dataclasses
import urllib.error
from datetime import UTC, datetime

from veille_llm.hf import Signal
from veille_llm.models import Item
from veille_llm.sources import SourceReport, collect_all
from veille_llm.sources.arxiv_source import arxiv_source
from veille_llm.sources.hf_source import hf_signals, with_signals
from veille_llm.sources.rss_source import rss_source

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2611.01234v2</id>
    <published>2026-11-20T10:00:00Z</published>
    <title>Mamba   meets GraphRAG</title>
    <summary>A state space model.</summary>
    <author><name>Ada Lovelace</name></author>
  </entry>
</feed>"""

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel><title>Blog</title>
  <item><title>New model released</title><link>https://example.com/a</link>
    <description>&lt;p&gt;Big &lt;b&gt;news&lt;/b&gt;&lt;/p&gt;</description>
    <pubDate>Fri, 20 Nov 2026 09:00:00 GMT</pubDate></item>
  <item><title></title><link>https://example.com/no-title</link></item>
  <item><title>No link</title></item>
</channel></rss>"""

ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
  <entry><title>Atom post</title><link href="https://example.com/b"/>
    <updated>2026-11-19T08:00:00Z</updated><summary>Short.</summary>
    <author><name>Grace</name></author></entry>
</feed>"""


def item(i="x"):
    return Item(i, "s", "paper", "t", "s", "u", [], "2026-11-20T00:00:00Z")


def http_error(code):
    return urllib.error.HTTPError("https://example.com", code, "err", {}, None)


def test_collect_all_isolates_a_failing_source():
    def boom(days):
        raise RuntimeError("down")

    items, reports = collect_all({"ok": lambda d: [item("a")], "bad": boom}, days=7)
    assert [i.id for i in items] == ["a"]
    by_name = {r.name: r for r in reports}
    assert by_name["ok"].ok and by_name["ok"].count == 1
    assert not by_name["bad"].ok and "RuntimeError" in by_name["bad"].error


def test_collect_all_reports_counts():
    _, reports = collect_all({"a": lambda d: [item("1"), item("2")]}, days=7)
    assert reports == [SourceReport(name="a", ok=True, count=2, error=None)]


def test_arxiv_source_retries_a_503_then_converts_items():
    calls = []

    def fetch(start, page_size):
        calls.append(start)
        if len(calls) == 1:
            raise http_error(503)
        return ARXIV_FEED

    (paper,) = arxiv_source(7, fetch=fetch, sleep=lambda s: None, now=NOW)
    assert paper.id == "arxiv:2611.01234"
    assert paper.kind == "paper" and paper.source == "arxiv"
    assert paper.title == "Mamba meets GraphRAG"
    assert paper.authors == ["Ada Lovelace"]
    assert len(calls) == 2


def test_arxiv_source_keeps_the_comment():
    feed = ARXIV_FEED.replace(
        "</entry>", "<arxiv:comment>ICML 2026 oral</arxiv:comment></entry>"
    ).replace("<feed ", '<feed xmlns:arxiv="http://arxiv.org/schemas/atom" ')
    (paper,) = arxiv_source(7, fetch=lambda start, size: feed, sleep=lambda s: None, now=NOW)
    assert paper.comment == "ICML 2026 oral"


def test_arxiv_source_gives_up_after_three_503_without_raising_to_collect_all():
    def fetch(start, page_size):
        raise http_error(503)

    import veille_llm.sources.arxiv_source as module

    source = lambda days: module.arxiv_source(days, fetch=fetch, sleep=lambda s: None, now=NOW)  # noqa: E731
    items, reports = collect_all({"arxiv": source}, days=7)
    assert items == []
    assert not reports[0].ok and "503" in reports[0].error


def test_hf_signals_returns_empty_on_error():
    def fetch():
        raise OSError("boom")

    assert hf_signals(fetch=fetch, sleep=lambda s: None) == {}


def test_hf_signals_parses_and_with_signals_applies_them():
    payload = b'[{"paper": {"id": "2611.01234", "upvotes": 12, "githubStars": 40}}]'
    signals = hf_signals(fetch=lambda: payload)
    assert signals == {"2611.01234": Signal(12, 40)}
    paper = dataclasses.replace(item("arxiv:2611.01234"), source="arxiv")
    news = dataclasses.replace(item("rss:zzz"), source="blog")
    updated = with_signals([paper, news], signals)
    assert [(i.upvotes, i.github_stars) for i in updated] == [(12, 40), (0, 0)]


def test_rss_source_parses_atom_and_rss():
    rss = rss_source("blog", "https://example.com/feed", fetch=lambda url: RSS.encode())
    (post,) = rss(7)
    assert post.kind == "news" and post.source == "blog"
    assert post.title == "New model released"
    assert post.summary == "Big news"
    assert post.published == "2026-11-20T09:00:00Z"
    atom = rss_source("blog", "https://example.com/feed", fetch=lambda url: ATOM.encode())
    (entry,) = atom(7)
    assert entry.authors == ["Grace"] and entry.published == "2026-11-19T08:00:00Z"


def test_rss_source_skips_entries_without_title_or_link():
    rss = rss_source("blog", "u", fetch=lambda url: RSS.encode())
    assert [i.title for i in rss(7)] == ["New model released"]


def test_rss_ids_are_stable_for_the_same_url():
    rss = rss_source("blog", "u", fetch=lambda url: RSS.encode())
    assert rss(7)[0].id == rss(7)[0].id
    assert rss(7)[0].id.startswith("rss:") and len(rss(7)[0].id) == len("rss:") + 16
