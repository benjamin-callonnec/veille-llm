"""Guards for the shared page chrome (logo in the page, floating settings gear, theme): they are CSS
facts, so they are checked on the stylesheets themselves."""

import re
from pathlib import Path

STYLES = Path(__file__).resolve().parents[2] / "web" / "src" / "styles"


def rule(css: str, selector: str) -> str:
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return match.group(1) if match else ""


CHROME = (STYLES / "chrome.css").read_text()
TOKENS = (STYLES / "tokens.css").read_text()


def test_the_logo_is_in_the_page_at_the_top_left_corner_and_does_not_float():
    r = rule(CHROME, ".home-logo")
    assert "position: absolute" in r  # part of the page: it scrolls away with it
    assert "position: fixed" not in r
    assert re.search(r"top:\s*\d+px", r) and re.search(r"left:\s*\d+px", r)


def test_the_settings_gear_is_fixed_in_the_bottom_left_corner_on_every_page():
    r = rule(CHROME, ".settings")
    assert "position: fixed" in r
    assert re.search(r"bottom:\s*\d+px", r) and re.search(r"left:\s*\d+px", r)
    assert "right:" not in r


def test_every_page_entry_renders_inside_the_shared_shell():
    web = STYLES.parent
    for entry in ("main.tsx", "reader/main.tsx"):
        source = (web / entry).read_text()
        assert "chrome.css" in source, entry
        assert "<AppShell" in source, entry


def test_pages_do_not_render_the_chrome_themselves():
    web = STYLES.parent
    for page in ("components/App.tsx", "reader/ReaderPage.tsx"):
        source = (web / page).read_text()
        assert "HomeLogo" not in source and "SettingsMenu" not in source, page


def test_a_theme_can_be_forced_over_the_system_appearance():
    assert "color-scheme: light" in rule(TOKENS, ':root[data-theme="light"]')
    assert "color-scheme: dark" in rule(TOKENS, ':root[data-theme="dark"]')
    for theme in ("light", "dark"):
        block = rule(TOKENS, f':root[data-theme="{theme}"]')
        for token in ("--bg", "--fg", "--card", "--accent", "--hl-yellow"):
            assert token in block, (theme, token)


def px(declarations: str, prop: str) -> list[int]:
    match = re.search(prop + r":\s*([^;]+);", declarations)
    return [int(v) for v in re.findall(r"(-?\d+)px", match.group(1))] if match else []


def test_the_page_head_starts_to_the_right_of_the_logo_on_every_page():
    """Title and logo sit on one line: the head leaves room for the fixed logo (16px + 32px)."""
    r = rule(CHROME, "header.page-head")
    assert "max-width: none" in r
    padding = px(r, "padding")  # top right bottom left
    assert len(padding) == 4 and padding[3] >= 56, padding
    assert px(r, "min-height") and px(r, "min-height")[0] >= 48


def test_both_pages_use_the_same_page_head():
    web = STYLES.parent
    for page in ("components/App.tsx", "reader/ReaderPage.tsx"):
        source = (web / page).read_text()
        assert "page-head" in source, page
