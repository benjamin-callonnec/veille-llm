from datetime import UTC, datetime

from veille_llm.newsletter.render import render

NOW = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)


def item(**over):
    base = {
        "id": "a",
        "title": "A paper",
        "url": "https://example.com/a",
        "category": "Agents",
        "type": "paper",
        "score": 8,
        "upvotes": 3,
        "published": "2026-11-20T00:00:00Z",
        "hook": "A bold hook.",
        "brief": "A brief.",
    }
    return {**base, **over}


def build(items=None, **kw):
    return render(items or [item()], week="2026-W48", contact="me@example.org", now=NOW, **kw)


def test_subject_names_the_week_and_item_count_on_one_line():
    mail = build([item(), item(id="b", title="Other")])
    assert mail.subject == "LLM watch · 2026-W48 · 2 items"
    assert "\n" not in mail.subject


def test_html_has_hook_in_bold_title_link_brief_and_category():
    html = build().html
    assert "<strong" in html and "A bold hook." in html
    assert 'href="https://example.com/a"' in html and "A paper" in html
    assert "A brief." in html and "Agents" in html


def test_text_version_lists_title_url_hook_and_brief():
    text = build().text
    for needle in ("A paper", "https://example.com/a", "A bold hook.", "A brief."):
        assert needle in text


def test_llm_text_is_escaped_in_html_and_cannot_break_the_subject():
    mail = build([item(title="<script>alert(1)</script>", hook="<img src=x onerror=1>")])
    assert "<script>" not in mail.html and "<img" not in mail.html
    assert "&lt;script&gt;" in mail.html
    assert "script" not in mail.subject


def test_only_http_links_become_links():
    mail = build([item(url="javascript:alert(1)", title="Evil")])
    assert "javascript:" not in mail.html and "javascript:" not in mail.text
    assert "Evil" in mail.html


def test_footer_has_a_mailto_unsubscribe_in_both_versions():
    mail = build()
    assert "mailto:me@example.org" in mail.html
    assert "me@example.org" in mail.text
    assert mail.unsubscribe == "me@example.org"


def test_a_contact_that_is_not_a_plain_address_is_refused():
    import pytest

    with pytest.raises(ValueError):
        render([item()], week="2026-W48", contact="x@y.org\r\nBcc: z@y.org", now=NOW)


def test_text_version_is_not_html_escaped():
    text = build([item(hook="Q&A beats <RAG> on cost")]).text
    assert "Q&A beats <RAG> on cost" in text


def test_html_version_escapes_ampersands():
    assert "Q&amp;A" in build([item(hook="Q&A")]).html


def test_urls_with_control_characters_are_never_linked_or_printed():
    for url in ("https://a.com/\nFAKE: line", "\x01https://a.com", "https://a.com/x\ty z"):
        mail = build([item(url=url, title="T")])
        assert "FAKE" not in mail.text and "a.com" not in mail.html and "a.com" not in mail.text


def test_the_other_category_is_not_shown_as_a_label():
    mail = build([item(category="Other")])
    assert "Other" not in mail.html and "Other" not in mail.text
    assert "paper" in mail.html.lower()
