from datetime import UTC, datetime

import pytest

from veille_llm.models import Enrichment, Item, Verdict
from veille_llm.newsletter.send import NewsletterError, send_newsletter
from veille_llm.store import Store

NOW = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)
STAMP = "2026-11-23T08:00:00Z"
WEEK = "2026-W48"
PEOPLE = ["a@x.org", "b@x.org", "c@x.org", "d@x.org"]


def seeded(n=5):
    store = Store(":memory:")
    items = [
        Item(
            f"i{k}", "src", "paper", f"T{k}", "S", f"https://e.com/{k}", [], "2026-11-20T00:00:00Z"
        )
        for k in range(n)
    ]
    store.upsert_items(items, STAMP)
    store.save_verdicts([Verdict(i.id, True, 5 + k % 4, "paper", "h") for k, i in enumerate(items)])
    store.save_enrichments([Enrichment(i.id, "Cat", f"Hook {i.id}.", "Brief.") for i in items])
    return store


class Mailer:
    def __init__(self, fail_at=None):
        self.sent, self.fail_at = [], fail_at

    def send(self, message):
        if self.fail_at is not None and len(self.sent) == self.fail_at:
            raise RuntimeError(f"550 mailbox {message['To']} unavailable")
        self.sent.append(message)


def go(store, mailer, people=PEOPLE, **kw):
    return send_newsletter(
        store, subscribers=people, mailer=mailer, now=NOW, contact="me@x.org",
        sender="LLM watch <news@x.org>", **kw,
    )  # fmt: skip


def test_one_message_per_recipient_never_a_list_and_with_unsubscribe_header():
    mailer = Mailer()
    result = go(seeded(), mailer)
    assert result.sent == 4 and [m["To"] for m in mailer.sent] == PEOPLE
    for message in mailer.sent:
        assert message["Bcc"] is None and message["Cc"] is None and "," not in message["To"]
        assert message["List-Unsubscribe"] == "<mailto:me@x.org>"
        assert message["From"] == "LLM watch <news@x.org>"
        assert message.get_body(("plain",)) is not None and message.get_body(("html",)) is not None


def test_a_second_run_in_the_same_week_sends_nothing():
    store, mailer = seeded(), Mailer()
    go(store, mailer)
    again = Mailer()
    result = go(store, again)
    assert result.already_sent and again.sent == []
    assert store.newsletter_progress(WEEK) == (4, 4)


def test_failure_stops_without_leaking_the_address_and_a_rerun_resumes():
    store = seeded()
    broken = Mailer(fail_at=2)
    with pytest.raises(NewsletterError) as err:
        go(store, broken)
    assert "c@x.org" not in str(err.value) and "#3" in str(err.value)
    assert store.newsletter_progress(WEEK) == (2, 4)
    fixed = Mailer()
    result = go(store, fixed)
    assert [m["To"] for m in fixed.sent] == ["c@x.org", "d@x.org"] and result.sent == 2
    assert store.newsletter_progress(WEEK) == (4, 4)


def test_a_week_without_items_sends_nothing_and_is_not_an_error():
    store, mailer = seeded(0), Mailer()
    result = go(store, mailer)
    assert result.nothing_to_send and result.sent == 0
    assert mailer.sent == [] and store.newsletter_progress(WEEK) is None


def test_even_a_single_item_is_worth_a_mail():
    mailer = Mailer()
    result = go(seeded(1), mailer)
    assert result.sent == 4 and "1 items" in mailer.sent[0]["Subject"]


def test_no_subscribers_is_an_error_not_a_silent_success():
    with pytest.raises(NewsletterError, match="subscriber"):
        go(seeded(), Mailer(), people=[])


def test_dry_run_writes_the_files_and_sends_nothing(tmp_path):
    store, mailer = seeded(), Mailer()
    result = go(store, mailer, dry_run=True, out_dir=tmp_path)
    assert mailer.sent == [] and store.newsletter_progress(WEEK) is None
    assert (tmp_path / "newsletter.html").exists() and (tmp_path / "newsletter.txt").exists()
    assert result.dry_run
