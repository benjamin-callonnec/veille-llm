from pathlib import Path

import yaml

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows"
RAW = (WF / "weekly.yml").read_text()
DOC = yaml.safe_load(RAW)
SECRETS = {
    "SUBSCRIBERS", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
    "NEWSLETTER_FROM", "NEWSLETTER_CONTACT",
}  # fmt: skip


def test_weekly_runs_only_when_dispatched_by_the_cloudflare_worker_or_by_hand():
    # GitHub's own cron starts hours late: the Worker `veille-llm-scheduler` dispatches it (#38)
    assert set(DOC.get("on", DOC.get(True))) == {"workflow_dispatch"}
    assert "schedule:" not in RAW and "cron:" not in RAW


def test_secrets_reach_only_the_send_step_and_never_the_persist_job():
    send = next(
        s for s in DOC["jobs"]["send"]["steps"] if "veille-newsletter send" in s.get("run", "")
    )
    assert set(send["env"]) == SECRETS
    assert "secrets." not in str(DOC["jobs"]["persist"]).replace("secrets.GITHUB_TOKEN", "")
    assert "GITHUB_TOKEN" not in str(DOC["jobs"]["send"])


def test_only_persist_can_write_and_it_runs_no_third_party_code():
    assert DOC["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["send"]["permissions"] == {"contents": "read"}
    assert DOC["jobs"]["persist"]["permissions"] == {"contents": "write"}
    assert "uv " not in str(DOC["jobs"]["persist"])


def test_counters_are_persisted_even_when_sending_failed_half_way():
    assert "always()" in DOC["jobs"]["persist"]["if"] and DOC["jobs"]["persist"]["needs"] == "send"


def test_send_runs_only_from_main_and_shares_the_data_branch_group():
    assert "refs/heads/main" in DOC["jobs"]["send"]["if"]
    assert DOC["concurrency"] == {"group": "data-branch", "cancel-in-progress": False}


def test_the_address_list_is_never_echoed_in_the_workflow():
    assert "echo" not in RAW and "cat subscribers" not in RAW
