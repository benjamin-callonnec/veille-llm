import asyncio
import io
import json
from datetime import UTC, datetime

from veille_llm.llm import LlmLimitError, RawReply
from veille_llm.models import Item
from veille_llm.pipeline.run import main, run_pipeline
from veille_llm.store import Store

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)
STAMP = "2026-11-21T12:00:00Z"


def news(i):
    return Item(
        f"rss:{i}",
        "blog",
        "news",
        f"Title {i}",
        "About LLM agents",
        f"https://e.com/{i}",
        [],
        "2026-11-20T10:00:00Z",
    )


def source(items):
    return {"blog": lambda days: list(items)}


def data_of(prompt):
    return json.loads(prompt.split("<data>")[1].split("</data>")[0])


class Llm:
    """Answers classification and enrichment prompts; can hit the limit on a given call."""

    def __init__(self, limit_on_call=None, reject=()):
        self.calls, self.limit_on_call, self.reject = 0, limit_on_call, set(reject)
        self.classified_ids = []
        self.models = set()

    async def __call__(self, prompt, options):
        self.calls += 1
        self.models.add(options.model)
        if self.calls == self.limit_on_call:
            raise LlmLimitError("usage limit reached")
        data = data_of(prompt)
        if "existing_categories" in prompt:
            entries = [
                {"id": d["id"], "category": "Agents", "hook": "Why it matters.", "brief": "Brief."}
                for d in data["items"]
            ]
        else:
            self.classified_ids.extend(d["id"] for d in data)
            entries = [
                {
                    "id": d["id"],
                    "interesting": d["id"] not in self.reject,
                    "score": 6,
                    "type": "news",
                    "category_hint": "agents",
                }
                for d in data
            ]
        return RawReply(json.dumps({"items": entries}), 1, 1, None)


def run(store, out, items, llm, **kw):
    return asyncio.run(
        run_pipeline(store, sources=source(items), days=7, now=NOW, out=out, runner=llm, **kw)
    )


def test_run_end_to_end_publishes_classified_items_only(tmp_path):
    store, out = Store(":memory:"), tmp_path / "c.json"
    report = run(store, out, [news("a"), news("b"), news("c")], Llm(reject={"rss:b"}))
    ids = [i["id"] for i in json.loads(out.read_text())["items"]]
    assert sorted(ids) == ["rss:a", "rss:c"]
    assert (report.collected, report.new, report.classified, report.enriched) == (3, 3, 3, 2)
    assert report.stopped is None


def test_run_resumes_after_a_limit_without_reclassifying(tmp_path):
    store, out = Store(":memory:"), tmp_path / "c.json"
    items = [news(f"{n:02d}") for n in range(20)]
    first = run(store, out, items, Llm(limit_on_call=2))
    assert first.classified == 15 and first.stopped.startswith("LlmLimitError")
    second_llm = Llm()
    second = run(store, out, items, second_llm)
    assert second.stopped is None
    assert len(second_llm.classified_ids) == 5
    assert len(json.loads(out.read_text())["items"]) == 20


def test_run_exports_even_when_the_llm_stops(tmp_path):
    out = tmp_path / "c.json"
    report = run(Store(":memory:"), out, [news("a")], Llm(limit_on_call=1))
    assert report.stopped is not None
    assert json.loads(out.read_text())["items"] == []


def test_run_with_all_sources_down_keeps_previous_export_and_does_not_raise(tmp_path):
    out = tmp_path / "c.json"
    out.write_text('{"previous": true}')

    def boom(days):
        raise RuntimeError("down")

    report = asyncio.run(
        run_pipeline(Store(":memory:"), sources={"a": boom}, days=7, now=NOW, out=out, runner=Llm())
    )
    assert json.loads(out.read_text()) == {"previous": True}
    assert not report.sources[0].ok


def test_run_abandons_items_unclassified_for_more_than_three_days(tmp_path):
    store = Store(":memory:")
    store.upsert_items([news("stale")], "2026-11-10T00:00:00Z")
    llm = Llm()
    run(store, tmp_path / "c.json", [], llm)
    assert llm.calls == 0
    assert store.pending_classification() == []


def test_run_with_no_items_ends_cleanly(tmp_path):
    report = run(Store(":memory:"), tmp_path / "c.json", [], Llm())
    assert (report.collected, report.new, report.classified) == (0, 0, 0)
    assert report.stopped is None


def test_main_returns_1_when_stopped_and_0_otherwise(tmp_path):
    args = ["run", "--db", str(tmp_path / "v.db"), "--out", str(tmp_path / "c.json")]
    assert main(args, sources=source([news("a")]), runner=Llm(limit_on_call=1), now=NOW) == 1
    assert main(args, sources=source([news("a")]), runner=Llm(), now=NOW) == 0


def test_run_refreshes_upvotes_of_papers_already_known(tmp_path):
    store, out = Store(":memory:"), tmp_path / "c.json"
    paper = Item(
        "arxiv:x",
        "arxiv",
        "paper",
        "LLM agents paper",
        "About LLM agents",
        "https://e.com",
        [],
        "2026-11-20T10:00:00Z",
    )
    run(store, out, [paper], Llm())
    assert json.loads(out.read_text())["items"][0]["upvotes"] == 0
    run(store, out, [paper], Llm(), upvotes=lambda: {"x": 9})
    assert json.loads(out.read_text())["items"][0]["upvotes"] == 9


def test_run_reports_skipped_batches_and_token_usage(tmp_path):
    llm = Llm()
    report = run(Store(":memory:"), tmp_path / "c.json", [news("a"), news("b")], llm)
    assert report.input_tokens == llm.calls and report.output_tokens == llm.calls
    assert report.skipped_batches == 0


def test_main_model_option_reaches_every_llm_call_and_defaults_to_haiku(tmp_path):
    args = ["run", "--db", str(tmp_path / "v.db"), "--out", str(tmp_path / "c.json")]
    sonnet, default = Llm(), Llm()
    main(
        [*args, "--model", "claude-sonnet-5-5"], sources=source([news("a")]), runner=sonnet, now=NOW
    )
    main(args, sources=source([news("b")]), runner=default, now=NOW)
    assert sonnet.models == {"claude-sonnet-5-5"}
    assert default.models == {"claude-haiku-5-5"}


def test_max_batches_caps_llm_calls_and_the_next_run_resumes(tmp_path):
    store, out = Store(":memory:"), tmp_path / "c.json"
    items = [news(f"{n:02d}") for n in range(20)]  # 2 classification batches, 2 enrichment
    first_llm = Llm()
    first = run(store, out, items, first_llm, max_batches=1)
    assert first_llm.calls == 1 and first.classified == 15 and first.enriched == 0
    assert first.capped and first.stopped is None
    second_llm = Llm()
    second = run(store, out, items, second_llm)
    assert not second.capped and second.stopped is None
    assert len(json.loads(out.read_text())["items"]) == 20


def test_max_batches_is_shared_between_classification_and_enrichment(tmp_path):
    llm = Llm()
    report = run(Store(":memory:"), tmp_path / "c.json", [news("a")], llm, max_batches=2)
    assert llm.calls == 2 and report.enriched == 1 and not report.capped


def test_main_defaults_to_20_batches_and_returns_0_when_capped(tmp_path):
    args = ["run", "--db", str(tmp_path / "v.db"), "--out", str(tmp_path / "c.json")]
    items = [news(f"{n:03d}") for n in range(20 * 15 + 1)]
    llm = Llm()
    assert main([*args, "--max-batches", "1"], sources=source(items), runner=llm, now=NOW) == 0
    assert llm.calls == 1


def test_capped_is_reported_when_the_budget_ends_before_the_hooks(tmp_path):
    report = run(Store(":memory:"), tmp_path / "c.json", [news("a")], Llm(), max_batches=1)
    assert report.classified == 1 and report.enriched == 0 and report.capped


def test_a_capped_backlog_still_leaves_budget_for_hooks(tmp_path):
    store, out = Store(":memory:"), tmp_path / "c.json"
    items = [news(f"{n:03d}") for n in range(15 * 6)]  # 6 classification batches
    first = run(store, out, items, Llm(), max_batches=3)
    assert first.classified == 15 * 2
    # Items still wait for classification: the next run must keep spending on both.
    second_llm = Llm()
    second = run(store, out, items, second_llm, max_batches=3)
    assert second.enriched > 0 and second.classified > 0


def test_main_rejects_a_zero_batch_budget(tmp_path):
    import pytest

    args = ["run", "--db", str(tmp_path / "v.db"), "--out", str(tmp_path / "c.json")]
    with pytest.raises(SystemExit):
        main([*args, "--max-batches", "0"], sources=source([news("a")]), runner=Llm(), now=NOW)


def test_run_fails_visibly_when_every_batch_is_rejected(tmp_path):
    class Garbage(Llm):
        async def __call__(self, prompt, options):
            return RawReply("not json", 1, 1, None)

    report = run(Store(":memory:"), tmp_path / "c.json", [news("a")], Garbage())
    assert report.classified == 0 and report.skipped_batches == 1 and report.stopped


def test_first_capped_run_already_publishes_something(tmp_path):
    # Real first run: 300 items classified, 0 hooks, empty catalogue. A share of the budget is
    # always kept for hooks, even when no hook is waiting yet.
    store, out = Store(":memory:"), tmp_path / "c.json"
    items = [news(f"{n:03d}") for n in range(15 * 6)]
    report = run(store, out, items, Llm(), max_batches=3)
    assert report.classified == 15 * 2 and report.enriched > 0
    assert json.loads(out.read_text())["items"]


def test_run_reports_progress_for_each_phase_and_batch(tmp_path):
    from veille_llm.pipeline.progress import Progress

    out = io.StringIO()
    progress = Progress(out, github=True)
    items = [news(f"{n:02d}") for n in range(20)]
    run(Store(":memory:"), tmp_path / "c.json", items, Llm(), progress=progress)
    text = out.getvalue()
    assert "::group::" in text and text.count("::endgroup::") == text.count("::group::")
    assert "[classify] batch 1/2" in text and "[classify] batch 2/2" in text
    assert "[hooks] batch 1/2" in text and "[hooks] batch 2/2" in text
    assert "http" not in text and "sk-ant" not in text


def test_main_writes_the_github_step_summary_when_asked(tmp_path, monkeypatch):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    args = ["run", "--db", str(tmp_path / "v.db"), "--out", str(tmp_path / "c.json")]
    main(args, sources=source([news("a")]), runner=Llm(), now=NOW)
    text = summary.read_text()
    assert "| classified | 1 |" in text and "| published | 1 |" in text


class ConsolidatingLlm:
    """Answers only the consolidation prompt, assigning every parked item to 'Agents'."""

    def __init__(self):
        self.calls = 0

    async def __call__(self, prompt, options):
        self.calls += 1
        data = data_of(prompt)
        assert "other_items" in data, "only the consolidation prompt is expected"
        assignments = [{"id": i["id"], "category": "Agents"} for i in data["other_items"]]
        return RawReply(json.dumps({"merges": [], "assignments": assignments}), 1, 1, None)


def parked_store():
    from veille_llm.models import Enrichment, Verdict

    store = Store(":memory:")
    rows = [(f"o{k:02d}", "Other") for k in range(8)] + [(f"a{k:02d}", "Agents") for k in range(4)]
    items = [
        Item(i, "src", "paper", f"T {i}", "S", "https://e.com", [], "2026-11-20T10:00:00Z")
        for i, _ in rows
    ]
    store.upsert_items(items, STAMP)
    store.save_verdicts([Verdict(i.id, True, 5, "paper", "h") for i in items])
    store.save_enrichments([Enrichment(i, c, "H.", "B.") for i, c in rows])
    return store


def test_run_consolidates_categories_when_other_is_too_big(tmp_path):
    store, llm = parked_store(), ConsolidatingLlm()
    report = run(store, tmp_path / "c.json", [], llm)
    assert llm.calls == 1 and report.reassigned == 8
    cats = {
        c["name"]: c["count"] for c in json.loads((tmp_path / "c.json").read_text())["categories"]
    }
    assert cats == {"Agents": 12}


class Both(Llm):
    """Classification and hooks like `Llm`, consolidation like `ConsolidatingLlm`."""

    async def __call__(self, prompt, options):
        if "other_items" in prompt:
            self.calls += 1
            data = data_of(prompt)
            assignments = [{"id": i["id"], "category": "Agents"} for i in data["other_items"]]
            return RawReply(json.dumps({"merges": [], "assignments": assignments}), 1, 1, None)
        return await super().__call__(prompt, options)


def test_consolidation_runs_even_when_the_batch_budget_is_spent_and_hooks_are_pending(tmp_path):
    # Real run: 14 classification + 6 hook batches used the whole cap of 20, and "Other" stayed
    # at 49% because consolidation waited for spare budget. It has its own small allowance.
    llm = Both()
    report = run(parked_store(), tmp_path / "c.json", [news("fresh")], llm, max_batches=1)
    assert report.reassigned == 8 and report.capped


def test_consolidation_does_not_consume_the_batch_budget(tmp_path):
    llm = ConsolidatingLlm()
    report = run(parked_store(), tmp_path / "c.json", [], llm, max_batches=1)
    assert llm.calls == 1 and report.reassigned == 8


def test_consolidation_repeats_while_other_stays_too_big_but_stops_when_it_is_not(tmp_path):
    from veille_llm.models import Enrichment, Verdict

    store = Store(":memory:")
    rows = [(f"o{k:03d}", "Other") for k in range(130)] + [
        (f"a{k:02d}", "Agents") for k in range(4)
    ]
    items = [
        Item(i, "src", "paper", f"T {i}", "S", "https://e.com", [], "2026-11-20T10:00:00Z")
        for i, _ in rows
    ]
    store.upsert_items(items, STAMP)
    store.save_verdicts([Verdict(i.id, True, 5, "paper", "h") for i in items])
    store.save_enrichments([Enrichment(i, c, "H.", "B.") for i, c in rows])
    llm = ConsolidatingLlm()
    report = run(store, tmp_path / "c.json", [], llm)
    # 60 + 60 re-homed, then Other is 10 of 134 items (under 25%): no third call
    assert llm.calls == 2 and report.reassigned == 120
