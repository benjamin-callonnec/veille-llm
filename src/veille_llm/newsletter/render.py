"""Render the weekly mail (subject, HTML and text) from the selected items."""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from jinja2 import Environment, FileSystemLoader, select_autoescape

from veille_llm.newsletter.subscribers import parse_addresses

_TEMPLATES = Path(__file__).parent / "templates"


@dataclass(frozen=True)
class Mail:
    subject: str
    html: str
    text: str
    unsubscribe: str


def _safe_url(url: str) -> str | None:
    """Only http(s) links are ever rendered as links."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    return url if parsed.scheme in ("http", "https") and parsed.netloc else None


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(_TEMPLATES),
        autoescape=select_autoescape(["html.j2"], default=False),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["safe_url"] = _safe_url
    return env


def render(items: list[dict], *, week: str, contact: str, now: datetime) -> Mail:
    valid, _ = parse_addresses(contact)
    if len(valid) != 1:
        raise ValueError("the unsubscribe contact must be one plain address")
    context = {
        "items": items,
        "week": week,
        "contact": valid[0],
        "date": now.strftime("%B %d, %Y").replace(" 0", " "),
    }
    env = _env()
    subject = f"LLM watch · {week} · {len(items)} items"  # fixed text: nothing from the items
    return Mail(
        subject=subject,
        html=env.get_template("newsletter.html.j2").render(**context),
        text=env.get_template("newsletter.txt.j2").render(**context),
        unsubscribe=valid[0],
    )
