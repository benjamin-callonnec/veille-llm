"""Read the changelog: the latest released version and one version's notes."""

import re
import sys
from pathlib import Path

_HEADING = re.compile(r"^## \[(?P<version>\d+\.\d+\.\d+)\]", re.MULTILINE)


def latest_version(changelog: str) -> str:
    match = _HEADING.search(changelog)
    if match is None:
        raise ValueError("no released version in the changelog")
    return match["version"]


def section(changelog: str, version: str) -> str:
    """The notes under `## [version]`, up to the next `## [` heading."""
    for match in _HEADING.finditer(changelog):
        if match["version"] == version:
            rest = changelog[match.end() :]
            body = rest.split("\n", 1)[1] if "\n" in rest else ""
            return re.split(r"^## \[", body, maxsplit=1, flags=re.MULTILINE)[0].strip() + "\n"
    raise ValueError(f"version {version} not in the changelog")


def main(argv: list[str] | None = None) -> int:
    """`python -m veille_llm.release notes [CHANGELOG]` prints the latest version's notes."""
    args = sys.argv[1:] if argv is None else argv
    path = Path(args[1] if len(args) > 1 else "CHANGELOG.md")
    text = path.read_text()
    if args[:1] == ["version"]:
        print(latest_version(text))
    elif args[:1] == ["notes"]:
        print(section(text, latest_version(text)), end="")
    else:
        print("usage: python -m veille_llm.release version|notes [CHANGELOG]", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
