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
    assert v["status"] == "page_only"
    # a section starts on page 3, so a bare page cannot tell which section is meant: no guess
    assert v["section"] is None


def test_a_too_short_quote_proves_nothing_so_it_counts_as_page_only():
    assert MIN_QUOTE_CHARS >= 8
    [v] = verdicts('[p.4 "BLEU"]')
    assert v["status"] == "page_only"


def test_the_same_citation_twice_is_listed_once():
    out = verdicts('[p.4 "achieves 28.4 BLEU"] and again [p.4 "achieves 28.4 BLEU"] and [p.3]')
    assert [(v["page"], v["status"]) for v in out] == [(4, "verified"), (3, "page_only")]


def test_a_bare_page_gets_a_section_only_when_the_whole_page_is_inside_one():
    outline = [("Introduction", 1), ("Methods", 3)]
    pages = ["intro one", "intro two", "methods start", "methods go on"]
    assert (
        verdicts("[p.2]", pages, outline)[0]["section"] == "Introduction"
    )  # no section starts there
    assert verdicts("[p.4]", pages, outline)[0]["section"] == "Methods"
    assert verdicts("[p.3]", pages, outline)[0]["section"] is None  # "Methods" starts on page 3
    assert verdicts("[p.1]", pages, outline)[0]["section"] is None
    assert verdicts("[p.4]", pages, [])[0]["section"] is None


DENSE = [
    "Title page\nAbstract text.",
    "1 Introduction\nRecurrent models are slow because they are sequential.\n"
    "2 Background\nSelf-attention relates different positions of a single sequence.\n"
    "3 Model Architecture\nThe encoder is a stack of six identical layers with two sub-layers.",
    "More of the architecture here, with the decoder stack.\n4 Results\nThe big model scores well.",
]
DENSE_OUTLINE = [("Introduction", 2), ("Background", 2), ("Model Architecture", 2), ("Results", 3)]


def test_the_section_follows_the_position_of_the_quote_on_a_page_with_several_sections():
    cases = {
        "recurrent models are slow because": "Introduction",
        "self-attention relates different positions": "Background",
        "the encoder is a stack of six identical layers": "Model Architecture",
    }
    for quote, section in cases.items():
        [v] = verdicts(f'[p.2 "{quote}"]', DENSE, DENSE_OUTLINE)
        assert v["status"] == "verified" and v["section"] == section, quote


def test_text_before_the_first_heading_of_a_page_belongs_to_the_section_before():
    [v] = verdicts('[p.3 "more of the architecture here"]', DENSE, DENSE_OUTLINE)
    assert v["section"] == "Model Architecture"  # the section that was open at the end of page 2
    [after] = verdicts('[p.3 "the big model scores well"]', DENSE, DENSE_OUTLINE)
    assert after["section"] == "Results"


def test_a_word_of_the_body_that_looks_like_a_title_is_not_a_heading():
    pages = [
        "x",
        "1 Introduction\nBackground work is discussed here at length for you.\n"
        "2 Background\nreal background starts.",
    ]
    outline = [("Introduction", 2), ("Background", 2)]
    [v] = verdicts('[p.2 "background work is discussed here"]', pages, outline)
    assert v["section"] == "Introduction"


def test_a_misplaced_quote_gets_the_section_of_where_it_really_is():
    [v] = verdicts('[p.3 "the encoder is a stack of six identical layers"]', DENSE, DENSE_OUTLINE)
    assert v["status"] == "wrong_page" and v["found_page"] == 2
    assert v["section"] == "Model Architecture"


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


def test_when_no_heading_can_be_found_in_the_text_the_section_is_unknown_not_guessed():
    pages = ["no heading line here, only running text about attention and heads"]
    [v] = verdicts('[p.1 "running text about attention"]', pages, [("Introduction", 1)])
    assert v["status"] == "verified" and v["section"] is None


def test_a_quote_copied_from_the_escaped_text_the_model_saw_is_verified():
    # the tools and the quiz prompts show the model "a &amp; b &lt; c", the paper says "a & b < c"
    pages = ["Results\nWe show that a & b < c holds for every input."]
    for quoted in ("a &amp; b &lt; c holds", "a & b < c holds"):
        [v] = verify_citations(pages, [], parse_citations(f'[p.1 "{quoted}"]'))
        assert v["status"] == "verified"
        assert v["quote"] == "a & b < c holds"
