"""HTML reports written by the tutor: validation, tools and export names."""

import re

from veille_reader.storage import MAX_HTML_CHARS, ReaderStore
from veille_reader.tools import ToolError, _data, _int

MAX_TITLE = 120
# The same policy as web/src/reader/viewer/csp.ts: an exported file keeps it when opened from disk.
CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; "
    "font-src data:; base-uri 'none'; form-action 'none'"
)
_META = f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'
_DOCTYPE = re.compile(r"^\s*<!doctype[^>]*>", re.I)
# shortcut: a regex, not an HTML parser, so a URL built in JavaScript is not seen; the sandboxed
# viewer's CSP is the real barrier, this check keeps exported files self-contained.
_EXTERNAL = re.compile(
    r"""(?ix)
    \b(?:src|href|srcset|poster|action|formaction|data)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?//
    | @import
    | url\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?//
    """
)
_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def check_html(html: str) -> None:
    if not html.strip():
        raise ToolError("html must not be empty")
    if len(html) > MAX_HTML_CHARS:
        raise ToolError(f"a report is {MAX_HTML_CHARS} characters at most")
    if _EXTERNAL.search(html):
        raise ToolError(
            "External resources are not allowed: inline all CSS, JavaScript and images "
            "(images as data: URIs) and use no external URL."
        )


_SVG = re.compile(r"<svg\b([^>]*)>(.*?)</svg>", re.I | re.S)
_DECORATIVE = re.compile(
    r"""aria-hidden\s*=\s*["']?true|display\s*:\s*none|visibility\s*:\s*hidden""", re.I
)
_QUOTED = re.compile(r"""("[^"]*"|'[^']*')""")
_HIDDEN_ATTR = re.compile(r"(?:^|\s)hidden(?=\s|=|$)", re.I)


def _decorative(attrs: str) -> bool:
    """An icon sprite or a hidden icon: nothing to name, nothing to scale."""
    # `hidden` counts only as an attribute of its own, never inside a value (overflow:hidden)
    return bool(_DECORATIVE.search(attrs) or _HIDDEN_ATTR.search(_QUOTED.sub('""', attrs)))


_IMG = re.compile(r"<img\b[^>]*>", re.I)
MAX_WARNINGS = 5


def lint_html(html: str) -> list[str]:
    """What the model should fix before the report is good (the report is saved anyway)."""
    warnings = []
    for n, (attrs, body) in enumerate(_SVG.findall(html), start=1):
        if _decorative(attrs):
            continue
        if not re.search(r"<title\b", body, re.I):
            warnings.append(f"svg {n} has no <title> (give it a title that states what it shows)")
        if not re.search(r"\bviewBox\s*=", attrs, re.I):
            warnings.append(f"svg {n} has no viewBox (it would not scale)")
    for img in _IMG.findall(html):
        if not re.search(r"\balt\s*=", img, re.I):
            warnings.append("an <img> has no alt text")
            break
    return warnings[:MAX_WARNINGS]


def with_csp(html: str) -> str:
    """The page with the policy first (after the doctype); never searches for <head>."""
    found = _DOCTYPE.match(html)
    end = found.end() if found else 0
    return html[:end] + _META + html[end:]


def export_name(title: str) -> str:
    stem = _UNSAFE_NAME.sub("-", title).strip("-.")[:80]
    return f"{stem or 'report'}.html"


class ReportTools:
    """The two report tools of one paper (the skill gate is applied by the caller)."""

    def __init__(self, store: ReaderStore, item_id: str) -> None:
        self.store = store
        self.item_id = item_id

    def write(self, title: str, html: str, report_id: object = None) -> str:
        title = (title or "").strip()[:MAX_TITLE]
        if not title:
            raise ToolError("title must not be empty")
        check_html(html or "")
        wanted = None if report_id is None else _int(report_id, "report_id")
        try:
            saved = self.store.save_report(self.item_id, title, html, wanted)
        except KeyError:
            raise ToolError("There is no report with that id for this paper.") from None
        message = f"Saved report {saved['id']}, version {saved['version']}."
        warnings = lint_html(html)
        if warnings:
            message += (
                f" Fix these and call write_report again with report_id {saved['id']}: "
                + "; ".join(warnings)
                + "."
            )
        return message

    def read(self, report_id: object) -> str:
        view = self.store.report(self.item_id, _int(report_id, "report_id"))
        if view is None:
            raise ToolError("There is no report with that id for this paper.")
        return f"Report {view['id']}, version {view['version']}, title: {view['title']}\n" + _data(
            "report", view["html"]
        )
