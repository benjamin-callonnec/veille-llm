from pathlib import Path

import pytest

from veille_reader.skills import (
    MAX_DESCRIPTION,
    MAX_PROMPT,
    Skill,
    SkillError,
    check_directory,
    load_skills,
    parse_skill,
)

GOOD = """---
name: present
description: Make a presentation.
tools: [ask_user, write_report]
---

Do the thing.
"""


def test_parse_valid_skill():
    skill = parse_skill(GOOD, "present.md")
    assert skill == Skill(
        "present", "Make a presentation.", "Do the thing.", ("ask_user", "write_report")
    )


def test_tools_default_to_empty():
    text = "---\nname: a\ndescription: d\n---\nbody"
    assert parse_skill(text, "a.md").tools == ()


def test_rejects_unknown_tool():
    with pytest.raises(SkillError):
        parse_skill(GOOD.replace("write_report", "bash"), "present.md")


def test_rejects_name_not_matching_filename():
    with pytest.raises(SkillError):
        parse_skill(GOOD, "other.md")


@pytest.mark.parametrize("name", ["../x", "Present", "a b", "1a", ""])
def test_rejects_bad_name_regex(name):
    text = f"---\nname: '{name}'\ndescription: d\n---\nbody"
    with pytest.raises(SkillError):
        parse_skill(text, f"{name}.md")


def test_rejects_too_long_description_and_prompt():
    long_desc = f"---\nname: a\ndescription: {'x' * (MAX_DESCRIPTION + 1)}\n---\nbody"
    with pytest.raises(SkillError):
        parse_skill(long_desc, "a.md")
    long_prompt = f"---\nname: a\ndescription: d\n---\n{'x' * (MAX_PROMPT + 1)}"
    with pytest.raises(SkillError):
        parse_skill(long_prompt, "a.md")


@pytest.mark.parametrize(
    "text",
    [
        "no front matter",
        "---\nname: [unclosed\n---\nbody",
        "---\nname: a\n---\nbody",
        "---\n- a\n---\nb",
    ],
)
def test_rejects_missing_front_matter_and_bad_yaml(text):
    with pytest.raises(SkillError):
        parse_skill(text, "a.md")


def test_rejects_empty_prompt():
    with pytest.raises(SkillError):
        parse_skill("---\nname: a\ndescription: d\n---\n   ", "a.md")


def test_load_skills_skips_invalid_and_non_md(tmp_path):
    (tmp_path / "present.md").write_text(GOOD)
    (tmp_path / "broken.md").write_text("nope")
    (tmp_path / "notes.txt").write_text(GOOD)
    (tmp_path / "bad.md").write_bytes(b"\xff\xfe")
    assert [s.name for s in load_skills(tmp_path)] == ["present"]


def test_load_skills_missing_directory_is_empty(tmp_path):
    assert load_skills(tmp_path / "nope") == []


# --- SkillSession ---------------------------------------------------------------------

from veille_reader.skills import SkillSession  # noqa: E402
from veille_reader.tools import ToolError  # noqa: E402

PRESENT = Skill("present", "Make slides.", "Ask then write.", ("ask_user", "write_report"))
OTHER = Skill("other", "Another one.", "Other prompt.", ())


def test_skill_session_use_unlocks_tools():
    session = SkillSession([PRESENT, OTHER])
    assert session.allows("write_report") is False
    assert "Ask then write." in session.use("present")
    assert session.allows("write_report") is True
    assert session.allows("read_report") is False  # not listed by the skill


def test_skill_session_unknown_name_is_tool_error():
    with pytest.raises(ToolError):
        SkillSession([PRESENT]).use("nope")


def test_ungated_tools_are_always_allowed():
    assert SkillSession([]).allows("load_artifact") is True


def test_forced_skill_is_unlocked_from_start():
    session = SkillSession([PRESENT], forced=PRESENT)
    assert session.allows("write_report") is True
    assert "Ask then write." in session.system_prompt()


def test_catalogue_prompt_lists_name_and_description_only():
    text = SkillSession([PRESENT, OTHER]).system_prompt()
    assert "- present: Make slides." in text and "- other: Another one." in text
    assert "Ask then write." not in text


def test_empty_session_adds_nothing_to_the_system_prompt():
    assert SkillSession([]).system_prompt() == ""


REPO_SKILLS = Path(__file__).resolve().parents[2] / "skills"


def test_the_shipped_skills_are_valid():
    assert check_directory(REPO_SKILLS) == []


def test_present_skill_file_is_valid():
    skill = parse_skill((REPO_SKILLS / "present.md").read_text(encoding="utf-8"), "present.md")
    assert skill.tools == (
        "ask_user",
        "load_artifact",
        "search_paper",
        "write_report",
        "read_report",
    )
    assert len(skill.description) <= MAX_DESCRIPTION


def test_check_directory_reports_each_problem(tmp_path):
    (tmp_path / "present.md").write_text(GOOD)
    assert check_directory(tmp_path) == []
    (tmp_path / "broken.md").write_text("nope")
    problems = check_directory(tmp_path)
    assert len(problems) == 1 and problems[0].startswith("broken.md:") and "nope" not in problems[0]


def test_check_directory_refuses_an_empty_or_missing_folder(tmp_path):
    assert check_directory(tmp_path)
    assert check_directory(tmp_path / "nope")


def test_present_skill_asks_for_quoted_citations():
    text = (REPO_SKILLS / "present.md").read_text(encoding="utf-8")
    assert '[p.N "exact quote"]' in text
    assert "Figure K" in text and "Table K" in text
    assert check_directory(REPO_SKILLS) == []


def test_present_skill_asks_for_clean_but_never_empty_slides():
    text = (REPO_SKILLS / "present.md").read_text(encoding="utf-8")
    assert "at most about 40 words" not in text  # that rule produced a title and one sentence
    assert "2 to 4 short bullet points" in text
    assert "never a slide that is only a title and one sentence" in text.lower()
    for utility in (".cols", ".card", ".big"):  # the skeleton offers the layouts the rule names
        assert utility in text
    assert len(text) < 7500  # the prompt limit is 8000 characters
