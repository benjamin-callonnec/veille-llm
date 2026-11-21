"""Pipeline orchestrator and `veille-core` command."""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from veille_llm.llm import Runner
from veille_llm.pipeline.categorize import enrich_pending
from veille_llm.pipeline.classify import classify_pending
from veille_llm.pipeline.export import export_catalogue
from veille_llm.pipeline.filtering import deterministic_filter
from veille_llm.sources import RSS_FEEDS, Source, SourceReport, collect_all
from veille_llm.sources.arxiv_source import arxiv_source
from veille_llm.sources.hf_source import hf_upvotes, with_upvotes
from veille_llm.sources.rss_source import rss_source
from veille_llm.store import Store

_STAMP = "%Y-%m-%dT%H:%M:%SZ"


@dataclass
class RunReport:
    sources: list[SourceReport] = field(default_factory=list)
    collected: int = 0
    new: int = 0
    classified: int = 0
    enriched: int = 0
    published: int = 0
    stopped: str | None = None


async def run_pipeline(
    store: Store,
    *,
    sources: dict[str, Source],
    days: int,
    now: datetime,
    out: Path,
    runner: Runner | None = None,
    upvotes: Callable[[], dict[str, int]] | None = None,
) -> RunReport:
    report = RunReport()
    stamp = now.strftime(_STAMP)
    store.abandon_stale(stamp)

    items, report.sources = collect_all(sources, days)
    report.collected = len(items)
    if upvotes is not None:
        items = with_upvotes(items, upvotes())
    fresh = deterministic_filter(
        items, known_ids=store.known_ids([i.id for i in items]), now=now, days=days
    )
    report.new = store.upsert_items(fresh, stamp)

    classified = await classify_pending(store, runner=runner)
    report.classified = classified.classified
    report.stopped = classified.stopped
    if classified.stopped is None:  # never call the LLM again right after it stopped us
        enriched = await enrich_pending(store, runner=runner)
        report.enriched = enriched.enriched
        report.stopped = enriched.stopped

    export_catalogue(store, out, now=now)
    report.published = len(store.published_items("0000-01-01T00:00:00Z"))
    return report


def _summary(report: RunReport) -> str:
    lines = [
        f"collected={report.collected} new={report.new} classified={report.classified} "
        f"enriched={report.enriched} published={report.published}"
    ]
    for source in report.sources:
        status = "ok" if source.ok else f"FAILED ({source.error})"
        lines.append(f"  source {source.name}: {source.count} items, {status}")
    if report.stopped:
        lines.append(f"STOPPED: {report.stopped}")
    return "\n".join(lines)


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
    args = parser.parse_args(argv)

    live = sources is None
    if live:
        sources = {"arxiv": lambda days: arxiv_source(days)}
        sources.update({name: rss_source(name, url) for name, url in RSS_FEEDS.items()})
    store = Store(args.db)
    try:
        report = asyncio.run(
            run_pipeline(
                store,
                sources=sources,
                days=args.days,
                now=now or datetime.now(UTC),
                out=args.out,
                runner=runner,
                upvotes=hf_upvotes if live else None,
            )
        )
    finally:
        store.close()
    print(_summary(report))
    return 1 if report.stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
