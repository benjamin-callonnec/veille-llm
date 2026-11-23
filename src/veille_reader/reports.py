"""HTML reports written by the tutor: validation, tools and export names."""

import re

from veille_reader.storage import MAX_HTML_CHARS, ReaderStore
from veille_reader.tools import ToolError, _data, _int

MAX_TITLE = 120
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
        return f"Saved report {saved['id']}, version {saved['version']}."

    def read(self, report_id: object) -> str:
        view = self.store.report(self.item_id, _int(report_id, "report_id"))
        if view is None:
            raise ToolError("There is no report with that id for this paper.")
        return f"Report {view['id']}, version {view['version']}, title: {view['title']}\n" + _data(
            "report", view["html"]
        )
