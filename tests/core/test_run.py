import asyncio
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
                {"id": d["id"], "category": "Agents", "hook": "Why it matters."}
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


def test_main_model_option_reaches_every_llm_call_and_defaults_to_sonnet(tmp_path):
    args = ["run", "--db", str(tmp_path / "v.db"), "--out", str(tmp_path / "c.json")]
    haiku, default = Llm(), Llm()
    main([*args, "--model", "claude-haiku-5-5"], sources=source([news("a")]), runner=haiku, now=NOW)
    main(args, sources=source([news("b")]), runner=default, now=NOW)
    assert haiku.models == {"claude-haiku-5-5"}
    assert default.models == {"claude-sonnet-5-5"}
