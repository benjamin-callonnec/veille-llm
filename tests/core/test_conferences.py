import re
from datetime import UTC, date, datetime

from veille_llm.conferences import (
    CONFERENCES,
    Conference,
    active,
    conference_of,
    prioritise,
)
from veille_llm.models import Item

A = Conference(
    "Alpha 2026", re.compile(r"alpha\W{0,3}(20)?26", re.I), date(2026, 12, 10), date(2026, 12, 12)
)
B = Conference(
    "Beta 2026",
    re.compile(r"beta\W{0,3}(20)?26", re.I),
    date(2026, 12, 11),
    date(2026, 12, 13),
)
CAL = (A, B)


def at(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, tzinfo=UTC)


def test_the_window_runs_21_days_before_to_14_days_after_inclusive():
    assert not A.is_active(date(2026, 11, 18))  # start - 22
    assert A.is_active(date(2026, 11, 19))  # start - 21
    assert A.is_active(date(2026, 12, 26))  # end + 14
    assert not A.is_active(date(2026, 12, 27))  # end + 15


def test_active_lists_the_open_windows_in_calendar_order():
    assert active(at(date(2026, 12, 11)), CAL) == [A, B]
    assert active(at(date(2026, 11, 1)), CAL) == []


def test_conference_of_matches_the_comment_case_insensitively():
    now = at(date(2026, 12, 1))
    assert conference_of("Accepted at ALPHA 2026", now, CAL) is A
    assert conference_of("alpha'26 workshop", now, CAL) is A


def test_last_years_edition_or_no_comment_never_matches():
    now = at(date(2026, 12, 1))
    assert conference_of("Accepted at Alpha 2025", now, CAL) is None
    assert conference_of("", now, CAL) is None


def test_a_comment_matching_two_active_conferences_goes_to_the_first():
    assert conference_of("Alpha 2026 and Beta 2026", at(date(2026, 12, 11)), CAL) is A


def test_an_inactive_conference_is_never_returned():
    assert conference_of("Accepted at Alpha 2026", at(date(2026, 6, 1)), CAL) is None


def item(i: str, comment: str = "") -> Item:
    return Item(i, "arxiv", "paper", i, "s", "u", [], "2026-12-01T00:00:00Z", comment=comment)


def test_prioritise_puts_matching_items_first_and_keeps_each_group_in_order():
    items = [item("n1"), item("m1", "Alpha 2026"), item("n2"), item("m2", "alpha 26")]
    got = prioritise(items, at(date(2026, 12, 1)), CAL)
    assert [i.id for i in got] == ["m1", "m2", "n1", "n2"]


def test_prioritise_without_active_conference_changes_nothing():
    items = [item("n1"), item("m1", "Alpha 2026")]
    assert prioritise(items, at(date(2026, 6, 1)), CAL) == items


def test_the_real_calendar_is_well_formed():
    assert CONFERENCES
    assert len({c.name for c in CONFERENCES}) == len(CONFERENCES)
    for conference in CONFERENCES:
        assert conference.start <= conference.end
        assert not conference.pattern.search("")
        assert conference.pattern.flags & re.IGNORECASE
