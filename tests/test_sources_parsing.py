from veille_llm.arxiv import parse_feed
from veille_llm.hf import Signal, parse_signals

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2611.01234v2</id>
    <published>2026-11-20T10:00:00Z</published>
    <title>Mamba   meets
      GraphRAG</title>
    <summary>A state space model for knowledge graphs.</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
  </entry>
</feed>"""


def test_parse_feed_normalises_id_and_whitespace():
    (paper,) = parse_feed(FEED)
    assert paper.arxiv_id == "2611.01234"
    assert paper.title == "Mamba meets GraphRAG"
    assert paper.authors == ["Ada Lovelace", "Alan Turing"]
    assert paper.url == "https://arxiv.org/abs/2611.01234"


def test_parse_signals_skips_entries_without_id():
    payload = [{"paper": {"id": "2611.01234", "upvotes": 12}}, {"paper": {}}, {}]
    assert parse_signals(payload) == {"2611.01234": Signal(12, 0)}


def test_parse_signals_reads_the_github_stars_of_the_linked_repo():
    payload = [
        {
            "paper": {
                "id": "a",
                "upvotes": 3,
                "githubRepo": "https://github.com/x/y",
                "githubStars": 162,
            }
        },
        {"paper": {"id": "b", "upvotes": 1, "githubStars": None}},  # no repo linked
        {"paper": {"id": "c", "githubStars": "oops"}},  # malformed: a signal is never fatal
    ]
    assert parse_signals(payload) == {"a": Signal(3, 162), "b": Signal(1, 0), "c": Signal(0, 0)}
