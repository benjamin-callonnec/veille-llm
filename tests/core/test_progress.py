import asyncio
import io

from veille_llm.pipeline.progress import Progress, format_duration


def make(**kw):
    out = io.StringIO()
    return Progress(out, github=kw.pop("github", False), **kw), out


def test_format_duration():
    assert format_duration(5) == "5s"
    assert format_duration(65) == "1m05s"
    assert format_duration(3725) == "1h02m"


def test_batch_line_shows_position_items_tokens_cost_and_eta():
    clock = iter([0.0, 30.0])
    progress, out = make(clock=lambda: next(clock))
    progress.start()
    progress.batch("classify", 2, 10, items=30, tokens=12345, cost=0.0123)
    line = out.getvalue().strip().splitlines()[-1]
    assert "[classify]" in line and "batch 2/10" in line and "items 30" in line
    assert "12,345 tokens" in line and "$0.0123" in line and "elapsed 30s" in line
    assert "eta 2m00s" in line  # 8 batches left at 15 s per batch


def test_groups_use_github_markers_only_on_github_actions():
    gh, gh_out = make(github=True)
    gh.group("Classification")
    gh.endgroup()
    assert gh_out.getvalue().splitlines() == ["::group::Classification", "::endgroup::"]
    local, local_out = make(github=False)
    local.group("Classification")
    local.endgroup()
    assert "::" not in local_out.getvalue() and "Classification" in local_out.getvalue()


def test_heartbeat_prints_while_a_long_call_is_running():
    progress, out = make()

    async def scenario():
        progress.start()
        task = asyncio.create_task(progress.heartbeat(0.01))
        progress.phase = "classify"
        await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(scenario())
    assert "still running" in out.getvalue() and "classify" in out.getvalue()


def test_step_summary_is_written_as_markdown(tmp_path):
    progress, _ = make()
    target = tmp_path / "summary.md"
    progress.write_summary(
        target,
        {"collected": 10, "new": 4, "classified": 3, "enriched": 2, "published": 2, "cost": 0.05},
        capped=True,
        stopped=None,
    )
    text = target.read_text()
    assert text.startswith("## veille-core run")
    assert "| classified | 3 |" in text and "batch limit" in text.lower()


def test_step_summary_appends_instead_of_overwriting(tmp_path):
    progress, _ = make()
    target = tmp_path / "summary.md"
    target.write_text("previous step\n")
    progress.write_summary(target, {"collected": 1}, capped=False, stopped="LlmLimitError: x")
    assert target.read_text().startswith("previous step") and "STOPPED" in target.read_text()
