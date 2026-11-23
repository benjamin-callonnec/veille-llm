import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "setup" / "bootstrap.sh"


def run_bootstrap(tmp_path, listing: str) -> list[str]:
    """Run bootstrap.sh with a fake wrangler; return the wrangler commands it ran."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    fake = bin_dir / "wrangler"
    fake.write_text(
        '#!/bin/sh\necho "$@" >> "$FAKE_LOG"\n'
        'if [ "$1 $2 $3" = "r2 bucket list" ]; then cat "$FAKE_LISTING"; fi\n'
    )
    fake.chmod(0o755)
    (tmp_path / "listing.txt").write_text(listing)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_LOG": str(log),
        "FAKE_LISTING": str(tmp_path / "listing.txt"),
    }
    subprocess.run(["bash", str(SCRIPT)], env=env, check=True, capture_output=True)
    return log.read_text().splitlines()


def test_an_existing_bucket_is_left_alone_whatever_the_listing_format(tmp_path):
    for listing in (
        "name:           veille-llm-tfstate\ncreation_date:  2026-11-23\n",
        "veille-llm-tfstate\nother-bucket\n",
    ):
        calls = run_bootstrap(tmp_path, listing)
        assert not any("create" in c for c in calls), listing
        (tmp_path / "bin" / "wrangler").unlink()
        (tmp_path / "bin").rmdir()
        (tmp_path / "calls.log").unlink()


def test_a_bucket_with_a_longer_name_does_not_count_as_ours(tmp_path):
    calls = run_bootstrap(tmp_path, "name:  veille-llm-tfstate-old\n")
    assert "r2 bucket create veille-llm-tfstate" in calls


def test_an_empty_account_gets_the_bucket(tmp_path):
    assert "r2 bucket create veille-llm-tfstate" in run_bootstrap(tmp_path, "")
