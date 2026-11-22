"""Pipeline orchestrator and `veille-core` command."""

from __future__ import annotations

import argparse
import asyncio
import io
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from veille_llm.llm import DEFAULT_MODEL, RawReply, Runner, claude_runner
from veille_llm.pipeline.categorize import enrich_pending
from veille_llm.pipeline.classify import BATCH_SIZE, classify_pending
from veille_llm.pipeline.export import export_catalogue
from veille_llm.pipeline.filtering import deterministic_filter
from veille_llm.pipeline.progress import Progress
from veille_llm.sources import RSS_FEEDS, Source, SourceReport, collect_all
from veille_llm.sources.arxiv_source import arxiv_source
from veille_llm.sources.hf_source import hf_upvotes, with_upvotes
from veille_llm.sources.rss_source import rss_source
from veille_llm.store import Store

_STAMP = "%Y-%m-%dT%H:%M:%SZ"
DEFAULT_MAX_BATCHES = 20  # about 300 items per run; revisit once Haiku consumption is measured


@dataclass
class RunReport:
    sources: list[SourceReport] = field(default_factory=list)
    collected: int = 0
    new: int = 0
    classified: int = 0
    enriched: int = 0
    published: int = 0
    skipped_batches: int = 0
    skip_reasons: list[str] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    stopped: str | None = None
    capped: bool = False


class _Meter:
    """Wraps a runner to total tokens and the SDK's indicative cost over a run."""

    def __init__(self, inner: Runner) -> None:
        self.inner, self.input_tokens, self.output_tokens, self.cost_usd = inner, 0, 0, 0.0
        self.calls = 0

    async def __call__(self, prompt: str, options) -> RawReply:
        self.calls += 1
        reply = await self.inner(prompt, options)
        self.input_tokens += reply.input_tokens
        self.output_tokens += reply.output_tokens
        self.cost_usd += reply.cost_usd or 0.0
        return reply


async def run_pipeline(
    store: Store,
    *,
    sources: dict[str, Source],
    days: int,
    now: datetime,
    out: Path,
    runner: Runner | None = None,
    upvotes: Callable[[], dict[str, int]] | None = None,
    model: str = DEFAULT_MODEL,
    max_batches: int | None = None,
    progress: Progress | None = None,
    heartbeat_seconds: float = 60.0,
) -> RunReport:
    progress = progress or Progress(io.StringIO())  # silent unless the caller wants output
    progress.start()
    heartbeat = asyncio.create_task(progress.heartbeat(heartbeat_seconds))
    try:
        return await _run(
            store, sources, days, now, out, runner, upvotes, model, max_batches, progress
        )
    finally:
        heartbeat.cancel()


async def _run(
    store: Store,
    sources: dict[str, Source],
    days: int,
    now: datetime,
    out: Path,
    runner: Runner | None,
    upvotes: Callable[[], dict[str, int]] | None,
    model: str,
    max_batches: int | None,
    progress: Progress,
) -> RunReport:
    report = RunReport()
    meter = _Meter(runner or claude_runner)
    stamp = now.strftime(_STAMP)
    store.abandon_stale(stamp)

    progress.group("Collect")
    items, report.sources = collect_all(sources, days)
    report.collected = len(items)
    for source in report.sources:
        state = "ok" if source.ok else f"FAILED ({source.error})"
        progress.info(f"source {source.name}: {source.count} items, {state}")
    if upvotes is not None:
        items = with_upvotes(items, upvotes())
        store.refresh_upvotes({i.id: i.upvotes for i in items if i.upvotes})
    fresh = deterministic_filter(
        items, known_ids=store.known_ids([i.id for i in items]), now=now, days=days
    )
    report.new = store.upsert_items(fresh, stamp)
    progress.info(f"collected={report.collected} new={report.new}")
    progress.endgroup()

    # Always keep a third of the budget for hooks (more if many wait): otherwise a first run
    # classifies everything, publishes nothing, and a backlog abandons interesting items
    # (after 3 days) before they were ever enriched. Unused budget flows to the hooks anyway.
    classify_cap = max_batches
    if max_batches is not None:
        waiting = -(-len(store.pending_enrichment()) // BATCH_SIZE)
        classify_cap = max_batches - min(max(waiting, max_batches // 3), max_batches - 1)
    to_classify = len(store.pending_classification())
    progress.group("Classify")

    def classify_progress(n: int, total: int) -> None:
        progress.batch(
            "classify",
            n,
            total,
            items=min(n * BATCH_SIZE, to_classify),
            tokens=meter.input_tokens + meter.output_tokens,
            cost=meter.cost_usd,
        )

    classified = await classify_pending(
        store, runner=meter, model=model, max_batches=classify_cap, on_batch=classify_progress
    )
    progress.endgroup()
    report.classified = classified.classified
    report.skipped_batches = classified.skipped_batches
    report.skip_reasons = list(classified.skip_reasons)
    report.stopped = classified.stopped
    report.capped = classified.capped
    left = None if max_batches is None else max_batches - meter.calls
    if classified.stopped is None and not (left is not None and left <= 0):
        # never call the LLM again right after it stopped us or once the budget is spent
        to_enrich = len(store.pending_enrichment())
        progress.group("Hooks")

        def hooks_progress(n: int, total: int) -> None:
            progress.batch(
                "hooks",
                n,
                total,
                items=min(n * BATCH_SIZE, to_enrich),
                tokens=meter.input_tokens + meter.output_tokens,
                cost=meter.cost_usd,
            )

        enriched = await enrich_pending(
            store, runner=meter, model=model, max_batches=left, on_batch=hooks_progress
        )
        progress.endgroup()
        report.enriched = enriched.enriched
        report.skipped_batches += enriched.skipped_batches
        report.skip_reasons += enriched.skip_reasons
        report.stopped = enriched.stopped
        report.capped = report.capped or enriched.capped
    elif classified.stopped is None:
        report.capped = report.capped or bool(store.pending_enrichment())

    if report.stopped is None and report.classified == 0 and report.enriched == 0:
        if report.skipped_batches:
            report.stopped = "every LLM batch was rejected (see skipped reasons)"
    report.input_tokens, report.output_tokens = meter.input_tokens, meter.output_tokens
    report.cost_usd = meter.cost_usd
    progress.group("Export")
    export_catalogue(store, out, now=now)
    report.published = len(store.published_items("0000-01-01T00:00:00Z"))
    progress.info(f"published={report.published}")
    progress.endgroup()
    return report


def _summary(report: RunReport) -> str:
    lines = [
        f"collected={report.collected} new={report.new} classified={report.classified} "
        f"enriched={report.enriched} published={report.published}"
    ]
    lines.append(
        f"  llm: tokens in={report.input_tokens} out={report.output_tokens} "
        f"indicative_cost_usd={report.cost_usd:.4f} skipped_batches={report.skipped_batches}"
    )
    for reason in sorted(set(report.skip_reasons)):
        lines.append(f"  skipped: {reason} (x{report.skip_reasons.count(reason)})")
    for source in report.sources:
        status = "ok" if source.ok else f"FAILED ({source.error})"
        lines.append(f"  source {source.name}: {source.count} items, {status}")
    if report.capped:
        lines.append("CAPPED: batch limit reached, the rest resumes on the next run")
    if report.stopped:
        lines.append(f"STOPPED: {report.stopped}")
    return "\n".join(lines)


def _positive_int(text: str) -> int:
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return value


def main(
    argv: list[str] | None = None,
    *,
    sources: dict[str, Source] | None = None,
    runner: Runner | None = None,
    now: datetime | None = None,
) -> int:
    parser = argparse.ArgumentParser(prog="veille-core", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="collect, classify and export the catalogue")
    run.add_argument("--db", type=Path, default=Path("veille.db"))
    run.add_argument("--out", type=Path, default=Path("build/catalogue.json"))
    run.add_argument("--days", type=int, default=7)
    run.add_argument(
        "--max-batches",
        type=_positive_int,
        default=DEFAULT_MAX_BATCHES,
        help="LLM batches per run (classification + hooks); the rest waits for the next run",
    )
    run.add_argument("--model", default=DEFAULT_MODEL, help="Claude model used for every LLM call")
    args = parser.parse_args(argv)

    live = sources is None
    if live:
        sources = {"arxiv": lambda days: arxiv_source(days)}
        sources.update({name: rss_source(name, url) for name, url in RSS_FEEDS.items()})
    store = Store(args.db)
    progress = Progress(sys.stdout, github=os.environ.get("GITHUB_ACTIONS") == "true")
    try:
        report = asyncio.run(
            run_pipeline(
                store,
                sources=sources,
                days=args.days,
                now=now or datetime.now(UTC),
                out=args.out,
                runner=runner,
                model=args.model,
                max_batches=args.max_batches,
                upvotes=hf_upvotes if live else None,
                progress=progress,
            )
        )
    finally:
        store.close()
    print(_summary(report))
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        progress.write_summary(
            Path(summary_file),
            {
                "collected": report.collected,
                "new": report.new,
                "classified": report.classified,
                "enriched": report.enriched,
                "published": report.published,
                "skipped batches": report.skipped_batches,
                "input tokens": report.input_tokens,
                "output tokens": report.output_tokens,
                "indicative cost (USD)": round(report.cost_usd, 4),
            },
            capped=report.capped,
            stopped=report.stopped,
        )
    return 1 if report.stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
