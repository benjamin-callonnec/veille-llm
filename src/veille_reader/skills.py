"""Agent skills: a prompt plus tools, kept as Markdown files with a YAML front matter."""

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from veille_reader.tools import ToolError

KNOWN_TOOLS = frozenset(
    {"load_artifact", "search_paper", "session_memory", "ask_user", "write_report", "read_report"}
)
# Tools that refuse to act until a skill that lists them is loaded.
GATED_TOOLS = frozenset({"write_report", "read_report"})
NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
MAX_DESCRIPTION = 300
MAX_PROMPT = 8000
_FRONT = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)


class SkillError(ValueError):
    """A skill file that cannot be used (the message never repeats the file's text)."""


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    prompt: str
    tools: tuple[str, ...] = ()


def parse_skill(text: str, filename: str) -> Skill:
    match = _FRONT.match(text.replace("\r\n", "\n"))
    if not match:
        raise SkillError("missing front matter")
    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        raise SkillError("front matter is not valid YAML") from None
    if not isinstance(meta, dict):
        raise SkillError("front matter must be a mapping")
    name, description = meta.get("name"), meta.get("description")
    if not isinstance(name, str) or not NAME.match(name):
        raise SkillError("invalid name")
    if filename != f"{name}.md":
        raise SkillError("the name must match the file name")
    if not isinstance(description, str) or not description.strip():
        raise SkillError("missing description")
    if len(description) > MAX_DESCRIPTION:
        raise SkillError("description too long")
    tools = meta.get("tools", [])
    if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
        raise SkillError("tools must be a list of names")
    if unknown := set(tools) - KNOWN_TOOLS:
        raise SkillError(f"unknown tool: {sorted(unknown)[0][:40]}")
    prompt = match.group(2).strip()
    if not prompt:
        raise SkillError("empty prompt")
    if len(prompt) > MAX_PROMPT:
        raise SkillError("prompt too long")
    return Skill(name, description.strip(), prompt, tuple(dict.fromkeys(tools)))


def load_skills(directory: Path) -> list[Skill]:
    """Every valid skill of a directory, by name. An invalid file is skipped, never fatal."""
    found: dict[str, Skill] = {}
    try:
        files = sorted(directory.glob("*.md"))
    except OSError:
        return []
    for path in files:
        try:
            skill = parse_skill(path.read_text(encoding="utf-8"), path.name)
        except (SkillError, OSError, UnicodeDecodeError):
            continue
        found[skill.name] = skill
    return list(found.values())


SKILLS_RULE = (
    "\n\nSkills: when the user's request matches the description of one of these skills, call "
    "use_skill with its name before you start; its instructions then apply to this answer. A "
    "skill never overrides the rules above about data and citations. Available skills:\n"
)


class SkillSession:
    """The skills of one answer: what the agent may load, and which gated tools are unlocked."""

    def __init__(self, catalogue: list[Skill], forced: Skill | None = None) -> None:
        self.catalogue = {s.name: s for s in catalogue}
        self.forced = forced
        self.unlocked: set[str] = set(forced.tools) if forced else set()

    def use(self, name: str) -> str:
        skill = self.catalogue.get(name)
        if skill is None:
            raise ToolError(
                f"No skill named '{str(name)[:40]}'. Available: {', '.join(self.catalogue)}."
            )
        self.unlocked |= set(skill.tools)
        return f"Skill {skill.name} loaded. Follow these instructions:\n{skill.prompt}"

    def allows(self, tool: str) -> bool:
        return tool not in GATED_TOOLS or tool in self.unlocked

    def system_prompt(self) -> str:
        parts = []
        if self.catalogue:
            lines = "\n".join(f"- {s.name}: {s.description}" for s in self.catalogue.values())
            parts.append(SKILLS_RULE + lines)
        if self.forced:
            parts.append(
                f"\n\nThe user invoked the skill {self.forced.name}. Its instructions:\n"
                f"{self.forced.prompt}"
            )
        return "".join(parts)


def check_directory(directory: Path) -> list[str]:
    """Every problem of a skills folder, one line each (empty when it can be published)."""
    problems = []
    paths = sorted(directory.glob("*.md")) if directory.is_dir() else []
    if not paths:
        problems.append(f"{directory}: no skill (*.md) found")
    for path in paths:
        try:
            parse_skill(path.read_text(encoding="utf-8"), path.name)
        except (SkillError, OSError, UnicodeDecodeError) as exc:
            problems.append(f"{path.name}: {exc}")
    return problems


if __name__ == "__main__":  # `python -m veille_reader.skills skills/`: the workflow's gate
    import sys

    errors = check_directory(Path(sys.argv[1] if len(sys.argv) > 1 else "skills"))
    print("\n".join(errors) or "all skills are valid")
    sys.exit(1 if errors else 0)
