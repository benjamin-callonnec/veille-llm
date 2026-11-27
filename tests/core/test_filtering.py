import dataclasses
from datetime import UTC, datetime

from veille_llm.models import Item
from veille_llm.pipeline.filtering import deterministic_filter

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)


def make(
    i, *, kind="paper", title="Plain title", summary="", published="2026-11-20T10:00:00Z", upvotes=0
):
    return Item(i, "src", kind, title, summary, f"https://e.com/{i}", [], published, upvotes)


def keep(items, known=frozenset()):
    return [i.id for i in deterministic_filter(items, known_ids=set(known), now=NOW, days=7)]


def test_drops_items_outside_the_window():
    old = make("old", kind="news", published="2026-11-01T00:00:00Z")
    assert keep([old, make("new", kind="news")]) == ["new"]


def test_drops_known_ids():
    assert keep([make("a", kind="news"), make("b", kind="news")], known={"a"}) == ["b"]


def test_dedupes_by_id_and_by_normalised_title():
    items = [
        make("a", kind="news", title="Big  News!"),
        make("a", kind="news", title="Other"),
        make("b", kind="news", title="big news"),
        make("c", kind="news", title="Something else"),
    ]
    assert keep(items) == ["a", "c"]


def test_keeps_news_without_keywords():
    assert keep([make("n", kind="news", title="Company update")]) == ["n"]


def test_keeps_paper_matching_prefilter():
    assert keep([make("p", title="A new state space model for long sequences")]) == ["p"]
    assert keep([make("q", summary="We study LLM agents on a benchmark")]) == ["q"]


def test_drops_unrelated_paper():
    assert keep([make("p", title="Protein folding with graph kernels", summary="chemistry")]) == []


def test_keeps_unrelated_paper_with_enough_upvotes():
    assert keep([make("p", title="Protein folding", upvotes=5)]) == ["p"]
    assert keep([make("q", title="Protein folding", upvotes=4)]) == []


def test_keyword_needs_word_boundaries():
    assert keep([make("p", title="Mambalike is not a model name")]) == []


def test_empty_input_returns_empty():
    assert keep([]) == []


def test_keeps_a_keywordless_paper_tied_to_an_active_conference():
    tied = dataclasses.replace(make("t"), comment="Accepted at NeurIPS 2026")  # window is open
    assert keep([tied, make("plain")]) == ["t"]
