import pytest

from veille_reader.skills import (
    MAX_DESCRIPTION,
    MAX_PROMPT,
    Skill,
    SkillError,
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
