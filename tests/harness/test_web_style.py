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
        for token in ("--bg", "--fg", "--card", "--accent", "--dot-yellow"):
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


CHAT = (STYLES / "chat.css").read_text()


def test_message_actions_are_hidden_until_hover_or_focus():
    """Claude's behaviour: nothing under a message at rest; its actions show when you hover it."""
    assert "opacity: 0" in rule(CHAT, ".msg-actions")
    assert ".turn:hover .msg-actions" in CHAT and ".turn:focus-within .msg-actions" in CHAT
    assert "opacity: 1" in rule(CHAT, ".turn:hover .msg-actions,\n.turn:focus-within .msg-actions")
    # a touch screen cannot hover: the actions stay visible there
    assert "@media (hover: none)" in CHAT


def test_your_question_is_a_neutral_bubble_not_an_accent_coloured_one():
    r = rule(CHAT, ".user-message")
    assert "var(--bubble)" in r and "var(--accent" not in r


def test_the_composer_is_a_big_rounded_pill():
    r = rule(CHAT, ".composer")
    assert re.search(r"border-radius:\s*(2\d|3\d)px", r)


def _token_blocks():
    """The four places the theme tokens live: light, dark (system), light forced, dark forced."""
    media = re.findall(r"@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}", TOKENS)
    plain = re.findall(r"^:root \{([^}]*)\}", TOKENS, flags=re.M)
    return {
        "light": "\n".join(plain),
        "dark system": "\n".join(media),
        "light forced": rule(TOKENS, ':root[data-theme="light"]'),
        "dark forced": rule(TOKENS, ':root[data-theme="dark"]'),
    }


def _color(block: str, token: str) -> str | None:
    found = re.findall(rf"{re.escape(token)}:\s*(#[0-9a-fA-F]{{3,8}})", block)
    return found[0].lower() if found else None


def test_the_colour_dots_have_their_own_real_colours_in_every_theme():
    """The page highlights are dark in Nuit (black text on a white page); the dots must not be."""
    for name, block in _token_blocks().items():
        dots = [_color(block, f"--dot-{c}") for c in ("yellow", "green", "red")]
        assert all(dots), (name, dots)
        assert len(set(dots)) == 3, (name, dots)
        for background in ("--bg", "--card", "--composer"):
            assert _color(block, background) not in dots, (name, background)


def test_the_dots_use_the_dot_colours_and_the_page_highlights_keep_theirs():
    reader = (STYLES / "reader.css").read_text()
    for color in ("yellow", "green", "red"):
        assert f"var(--dot-{color})" in rule(reader, f".dot.hl-{color}")
        assert f"var(--hl-{color})" in rule(reader, f".hl-{color}")  # the page highlight


def test_the_selection_box_is_a_quiet_rounded_pill():
    reader = (STYLES / "reader.css").read_text()
    box = rule(reader, ".selection-box")
    assert re.search(r"border-radius:\s*(2\d|3\d)px", box)
    assert "var(--composer)" in box


def test_highlights_over_the_white_page_use_the_same_light_colours_in_every_theme():
    """The PDF page stays white in Nuit, and highlights are multiplied over it: a dark colour there
    turns the text black. Only the interface (the dots) changes with the theme."""
    blocks = _token_blocks()
    for color in ("yellow", "green", "red"):
        values = {name: _color(block, f"--hl-{color}") for name, block in blocks.items()}
        value = values["light"]
        assert value is not None
        # a dark block either inherits the light colour (no override) or repeats it
        assert all(v in (None, value) for v in values.values()), (color, values)
        channels = [int(value[i : i + 2], 16) for i in (1, 3, 5)]
        assert min(channels) >= 0xC0 - 0x20, (color, value)  # a light colour, not a dark one


def test_a_highlight_row_in_the_list_keeps_dark_text_on_its_light_colour():
    reader = (STYLES / "reader.css").read_text()
    row = rule(reader, ".highlights-strip li button:first-child")
    assert "color: #1b1b19" in row
