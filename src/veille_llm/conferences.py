"""Dated calendar of the big ML conferences, and which arXiv comments belong to an active one.

Papers cluster around these events (acceptances, camera-ready, talks). A conference is "active"
from `LEAD_DAYS` before it starts to `TAIL_DAYS` after it ends. The calendar is a hand-kept list,
checked against the official sites; update it once a year (an edition missing from it simply
means no priority and no newsletter section, never an error).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from veille_llm.models import Item

LEAD_DAYS = 21
TAIL_DAYS = 14


@dataclass(frozen=True)
class Conference:
    name: str  # shown in the newsletter, e.g. "NeurIPS 2026"
    pattern: re.Pattern[str]  # matched against the arXiv comment of a paper
    start: date
    end: date

    def is_active(self, day: date) -> bool:
        return self.start - timedelta(days=LEAD_DAYS) <= day <= self.end + timedelta(days=TAIL_DAYS)


def _edition(label: str, year: int) -> re.Pattern[str]:
    """`label` and this year ("2026", "'26", "26"): last year's edition must not match."""
    return re.compile(rf"\b(?:{label})\W{{0,3}}(?:20)?{year % 100}\b", re.IGNORECASE)


# Dates from the official sites, checked on 2026-11-27 (main conference and workshops).
# Not listed: ICML, ACL, EMNLP and COLM 2026 (over), EMNLP 2027 and COLM 2027 (no official date).
CONFERENCES: tuple[Conference, ...] = (
    Conference(
        "NeurIPS 2026", _edition(r"neur\s?ips|nips", 2026), date(2026, 12, 6), date(2026, 12, 13)
    ),
    Conference("ICLR 2027", _edition("iclr", 2027), date(2027, 4, 26), date(2027, 4, 30)),
    Conference("CVPR 2027", _edition("cvpr", 2027), date(2027, 6, 20), date(2027, 6, 25)),
    # unverified: the official site only says "South America"; the dates are third-party listings
    Conference("ICML 2027", _edition("icml", 2027), date(2027, 7, 31), date(2027, 8, 6)),
    Conference("ACL 2027", _edition("acl", 2027), date(2027, 8, 17), date(2027, 8, 22)),
)


def active(now: datetime, calendar: Sequence[Conference] = CONFERENCES) -> list[Conference]:
    return [c for c in calendar if c.is_active(now.date())]


def conference_of(
    comment: str, now: datetime, calendar: Sequence[Conference] = CONFERENCES
) -> Conference | None:
    """The first active conference whose pattern matches the comment, if any."""
    return next((c for c in active(now, calendar) if c.pattern.search(comment)), None)


def prioritise(
    items: list[Item], now: datetime, calendar: Sequence[Conference] = CONFERENCES
) -> list[Item]:
    """Items tied to an active conference first; each group keeps its order."""
    tied = [i for i in items if conference_of(i.comment, now, calendar)]
    rest = [i for i in items if not conference_of(i.comment, now, calendar)]
    return tied + rest
