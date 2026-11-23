"""Pull the skills from a GitHub release (one zip asset) into a local cache folder.

The skills live in `skills/*.md` on `main`; a workflow validates them and publishes them as
`skills.zip` on the release tagged `skills`. The cache is disposable: anything that fails keeps it
as it was, so the reader never depends on the network to start.
"""

import io
import os
import re
import shutil
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

from veille_reader.pdf import Fetcher
from veille_reader.skills import SkillError, parse_skill

SKILLS_REPO = "benjamin-callonnec/veille-llm"
SKILLS_TAG = "skills"
SKILLS_ASSET = "skills.zip"
MAX_SKILL_BYTES = 20_000
MAX_SKILL_FILES = 50
MAX_ZIP_BYTES = 1_000_000
TIMEOUT_SECONDS = 15
FILE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}\.md$")
_HOSTS = ("github.com", "githubusercontent.com")
_SWAP = threading.Lock()  # the startup sync and a manual one never swap the cache together


def _github_host(host: str | None) -> bool:
    return bool(host) and any(host == h or host.endswith("." + h) for h in _HOSTS)


class _GithubOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        parts = urlsplit(newurl)
        if parts.scheme != "https" or not _github_host(parts.hostname):
            raise OSError("redirect outside GitHub refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_fetcher(url: str) -> bytes:
    """GET a GitHub URL over https (redirects stay on GitHub), with a size and time limit."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not _github_host(parts.hostname):
        raise OSError("refused: not a GitHub URL")
    request = urllib.request.Request(url, headers={"User-Agent": "veille-reader"})  # noqa: S310
    with urllib.request.build_opener(_GithubOnly).open(request, timeout=TIMEOUT_SECONDS) as r:
        return r.read(MAX_ZIP_BYTES + 1)


def _skills_of(data: bytes) -> dict[str, str]:
    """The valid skills of a zip: flat `<name>.md` entries only, each size-checked and parsed."""
    if len(data) > MAX_ZIP_BYTES:
        raise OSError("the skills zip is too big")
    found: dict[str, str] = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist()[:MAX_SKILL_FILES]:
            name = info.filename
            # a flat file name only: no folder, no `..`, nothing outside the cache
            if info.is_dir() or not FILE_NAME.match(name) or info.file_size > MAX_SKILL_BYTES:
                continue
            with archive.open(info) as member:
                raw = member.read(MAX_SKILL_BYTES + 1)
            if len(raw) > MAX_SKILL_BYTES:
                continue  # the header lied about the size
            try:
                text = raw.decode("utf-8")
                parse_skill(text, name)
            except (UnicodeDecodeError, SkillError):
                continue
            found[name] = text
    return found


def sync_skills(
    cache: Path,
    fetch: Fetcher = default_fetcher,
    repo: str = SKILLS_REPO,
) -> int:
    """Replace the cache by the valid skills of the release. Count written, -1 if nothing came."""
    url = f"https://github.com/{repo}/releases/download/{SKILLS_TAG}/{SKILLS_ASSET}"
    try:
        files = _skills_of(fetch(url))
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError):
        return -1
    if not files:
        return -1  # nothing usable (a release is never meant to be empty): keep the cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".skills-", dir=cache.parent))
    backup = staging.with_name(staging.name + "-old")
    with _SWAP:
        try:
            for name, text in files.items():
                (staging / name).write_text(text, encoding="utf-8")
            had_cache = cache.exists()
            if had_cache:
                os.replace(cache, backup)
            try:
                os.replace(staging, cache)
            except OSError:
                if had_cache:
                    os.replace(backup, cache)  # put the previous cache back
                raise
        except OSError:
            shutil.rmtree(staging, ignore_errors=True)
            return -1
        shutil.rmtree(backup, ignore_errors=True)
    return len(files)
