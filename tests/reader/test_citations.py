from veille_reader.citations import MIN_QUOTE_CHARS, normalise, parse_citations, verify_citations

PAGES = [
    "Attention Is All You Need\nThe dominant sequence transduction models are based on "
    "recurrent networks.",
    "1 Introduction\nRecurrent models typically factor computation along the symbol positions "
    "of the input and output sequences.",
    "2 Model Architecture\nMulti-head attention allows the model to jointly attend to "
    "information from different representation subspaces.\nThe ﬁnal results are good.",
    "3 Results\nThe big model achieves 28.4 BLEU on the WMT 2014 English-to-German "
    "translation task.",
]
OUTLINE = [("Introduction", 2), ("Model Architecture", 3), ("Results", 4)]


def verdicts(text, pages=PAGES, outline=OUTLINE):
    return verify_citations(pages, outline, parse_citations(text))


# --- parsing ---------------------------------------------------------------------------------


def test_a_citation_with_only_a_page():
    [c] = parse_citations("See [p.4] for details.")
    assert (c.page, c.quote) == (4, None)


def test_a_citation_with_a_quote():
    [c] = parse_citations('It says [p.4 "achieves 28.4 BLEU"].')
    assert (c.page, c.quote) == (4, "achieves 28.4 BLEU")


def test_curly_quotes_and_a_colon_are_accepted():
    [a, b] = parse_citations("One [p.2: “a quoted phrase here”] and two [p.3 «another phrase»].")
    assert (a.page, a.quote) == (2, "a quoted phrase here")
    assert (b.page, b.quote) == (3, "another phrase")


def test_several_citations_keep_their_positions():
    text = 'A [p.1] then B [p.2 "some quote here"] end'
    first, second = parse_citations(text)
    assert text[first.start : first.end] == "[p.1]"
    assert text[second.start : second.end] == '[p.2 "some quote here"]'


def test_things_that_are_not_citations_are_ignored():
    assert parse_citations("[p.x] [page 4] p.4 [p.] [p.4 no quotes here]") == []


def test_an_absurdly_long_quote_is_not_a_quote():
    [c] = parse_citations(f'[p.1 "{"x" * 500}"]')
    assert c.quote is None or len(c.quote) <= 300


# --- verification ----------------------------------------------------------------------------


def test_a_quote_found_on_the_cited_page_is_verified():
    [v] = verdicts('[p.4 "achieves 28.4 BLEU on the WMT 2014"]')
    assert v["status"] == "verified" and v["page"] == 4 and v["section"] == "Results"


def test_spacing_case_hyphens_quotes_and_ligatures_do_not_matter():
    for quote in (
        "MULTI-HEAD   attention allows",
        "multihead attention allows the model",
        "the final results are good",  # the page says "ﬁnal" with a ligature
        "attend to information from different representation subspaces",
    ):
        [v] = verdicts(f'[p.3 "{quote}"]')
        assert v["status"] == "verified", quote


def test_a_quote_from_another_page_says_where_it_really_is():
    [v] = verdicts('[p.2 "achieves 28.4 BLEU on the WMT 2014"]')
    assert v["status"] == "wrong_page" and v["found_page"] == 4 and v["section"] == "Results"


def test_a_quote_that_is_nowhere_is_unverified():
    [v] = verdicts('[p.2 "the model beats every human expert"]')
    assert v["status"] == "unverified" and "found_page" not in v


def test_a_page_that_does_not_exist_is_flagged():
    [v] = verdicts('[p.99 "achieves 28.4 BLEU"]')
    assert v["status"] == "invalid_page"
    [v0] = verdicts("[p.0]")
    assert v0["status"] == "invalid_page"


def test_a_citation_without_a_quote_is_page_only():
    [v] = verdicts("[p.3]")
    assert v["status"] == "page_only" and v["section"] == "Model Architecture"


def test_a_too_short_quote_proves_nothing_so_it_counts_as_page_only():
    assert MIN_QUOTE_CHARS >= 8
    [v] = verdicts('[p.4 "BLEU"]')
    assert v["status"] == "page_only"


def test_the_same_citation_twice_is_listed_once():
    out = verdicts('[p.4 "achieves 28.4 BLEU"] and again [p.4 "achieves 28.4 BLEU"] and [p.3]')
    assert [(v["page"], v["status"]) for v in out] == [(4, "verified"), (3, "page_only")]


def test_the_section_is_the_last_outline_entry_before_the_page():
    assert verdicts("[p.1]")[0]["section"] is None  # before the first section
    assert verdicts("[p.2]")[0]["section"] == "Introduction"
    assert verdicts("[p.3]")[0]["section"] == "Model Architecture"
    assert verdicts("[p.4]", outline=[])[0]["section"] is None


def test_normalise_is_idempotent_and_ignores_punctuation_and_spacing():
    assert normalise("Multi-head,  “attention”!\n") == normalise("multihead attention")
    assert normalise(normalise("Some TEXT")) == normalise("Some TEXT")


def test_a_big_document_is_checked_quickly():
    import time

    pages = ["lorem ipsum dolor sit amet " * 400 for _ in range(400)]
    started = time.monotonic()
    out = verify_citations(
        pages, [], parse_citations('[p.200 "nothing like this anywhere at all"]')
    )
    assert out[0]["status"] == "unverified"
    assert time.monotonic() - started < 3
