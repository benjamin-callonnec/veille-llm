"""Pull the skills from the `skills` branch of the repo into a local cache folder.

The repo is the source of truth; the cache is disposable. Anything that fails keeps the cache
as it was: the reader never depends on the network to start.
"""

import json
import os
import re
import shutil
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from veille_reader.pdf import Fetcher
from veille_reader.skills import SkillError, parse_skill

SKILLS_REPO = "benjamin-callonnec/veille-llm"
SKILLS_BRANCH = "skills"
MAX_SKILL_BYTES = 20_000
MAX_SKILL_FILES = 50
MAX_LISTING_BYTES = 200_000
TIMEOUT_SECONDS = 10
FILE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}\.md$")
RAW_HOST = "raw.githubusercontent.com"
API_HOST = "api.github.com"


def default_fetcher(url: str) -> bytes:
    """GET a GitHub URL (https, the two GitHub hosts only), with a size and time limit."""
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in (RAW_HOST, API_HOST):
        raise OSError("refused: not a GitHub URL")
    request = urllib.request.Request(url, headers={"User-Agent": "veille-reader"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return response.read(MAX_LISTING_BYTES + 1)


def sync_skills(
    cache: Path,
    fetch: Fetcher = default_fetcher,
    repo: str = SKILLS_REPO,
    branch: str = SKILLS_BRANCH,
) -> int:
    """Replace the cache by the valid skills of the branch. Count written, -1 if nothing came."""
    try:
        listing = json.loads(fetch(f"https://{API_HOST}/repos/{repo}/contents/skills?ref={branch}"))
        if not isinstance(listing, list):
            return -1
    except (OSError, ValueError):
        return -1
    files: dict[str, str] = {}
    for entry in listing[:MAX_SKILL_FILES]:
        if not isinstance(entry, dict) or entry.get("type") != "file":
            continue
        name, url = entry.get("name"), entry.get("download_url")
        if not isinstance(name, str) or not FILE_NAME.match(name) or not isinstance(url, str):
            continue
        if urlsplit(url).hostname != RAW_HOST or urlsplit(url).scheme != "https":
            continue
        try:
            data = fetch(url)
            if len(data) > MAX_SKILL_BYTES:
                continue
            text = data.decode("utf-8")
            parse_skill(text, name)
        except (OSError, UnicodeDecodeError, SkillError):
            continue
        files[name] = text
    if not files and listing:
        return -1  # a listing with files but none usable: keep what we have
    cache.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".skills-", dir=cache.parent))
    try:
        for name, text in files.items():
            (staging / name).write_text(text, encoding="utf-8")
        if cache.exists():
            shutil.rmtree(cache)
        os.replace(staging, cache)
    except OSError:
        shutil.rmtree(staging, ignore_errors=True)
        return -1
    return len(files)
