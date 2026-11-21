from datetime import UTC, datetime

from veille_llm.arxiv import Paper, parse_feed
from veille_llm.build import build_payload
from veille_llm.hf import parse_upvotes
from veille_llm.topics import classify

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


def test_classify_matches_several_topics_in_order():
    topics = classify("Mamba meets GraphRAG", "A state space model for knowledge graphs.")
    assert topics == ["alt-architectures", "knowledge-graphs"]


def test_classify_returns_nothing_for_unrelated_paper():
    assert classify("Protein folding", "We study enzymes.") == []


def test_classify_does_not_match_inside_words():
    assert classify("Cartridge tooling", "Nothing about graphs of knowledge here.") == []


def test_parse_upvotes_skips_entries_without_id():
    payload = [{"paper": {"id": "2611.01234", "upvotes": 12}}, {"paper": {}}, {}]
    assert parse_upvotes(payload) == {"2611.01234": 12}


def test_build_payload_keeps_only_watched_topics_and_attaches_upvotes():
    kept = Paper("2611.01234", "LSTM revival", "xLSTM beats it", ["A"], "2026-11-20T10:00:00Z", "u")
    dropped = Paper("2611.99999", "Protein folding", "enzymes", ["B"], "2026-11-21T10:00:00Z", "u")
    payload = build_payload(
        [dropped, kept], {"2611.01234": 7}, datetime(2026, 11, 21, 6, tzinfo=UTC)
    )
    assert payload["generated_at"] == "2026-11-21T06:00:00Z"
    assert [p["id"] for p in payload["papers"]] == ["2611.01234"]
    assert payload["papers"][0]["upvotes"] == 7
    assert payload["papers"][0]["topics"] == ["lstm-rnn"]
