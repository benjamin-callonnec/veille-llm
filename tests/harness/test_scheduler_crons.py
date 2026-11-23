import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TERRAFORM = (ROOT / "iac" / "main.tf").read_text()
DISPATCH = (ROOT / "scheduler" / "src" / "dispatch.ts").read_text()


def _terraform_crons() -> set[str]:
    block = re.search(r"crons\s*=\s*\[(.*?)\]", TERRAFORM, re.DOTALL)
    assert block, "iac/main.tf has no crons list"
    return set(re.findall(r'"([^"]+)"', block.group(1)))


def _worker_workflows() -> dict[str, str]:
    block = re.search(r"WORKFLOWS[^=]*=\s*\{(.*?)\}", DISPATCH, re.DOTALL)
    assert block, "dispatch.ts has no WORKFLOWS map"
    return dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', block.group(1)))


def test_terraform_and_the_worker_know_the_same_crons():
    assert _terraform_crons() == set(_worker_workflows())


def test_every_cron_starts_a_workflow_that_exists_and_can_be_dispatched():
    for workflow in _worker_workflows().values():
        text = (ROOT / ".github" / "workflows" / workflow).read_text()
        assert "workflow_dispatch" in text, workflow


def test_the_crons_match_the_documented_times():
    assert _worker_workflows() == {"0 6 * * *": "daily.yml", "0 8 * * 1": "weekly.yml"}


def test_terraform_and_setup_files_hold_no_account_id_or_token():
    files = [
        p
        for folder in ("iac", "setup")
        for p in (ROOT / folder).rglob("*")
        if p.is_file() and ".terraform" not in p.parts and p.name != ".terraform.lock.hcl"
    ]
    assert files, "no iac/ or setup/ file found"
    for path in files:
        text = path.read_text()
        assert not re.search(r"\b[0-9a-f]{32}\b", text), f"{path}: looks like an account id"
        assert "ghp_" not in text and "github_pat_" not in text, f"{path}: looks like a token"
