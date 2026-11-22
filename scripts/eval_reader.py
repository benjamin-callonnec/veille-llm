"""Measure how well the reader's tutor cites (issue #31).

    uv run python scripts/eval_reader.py [--cases evals/reader_cases.json] [--limit N]
        [--ids a,b] [--model M] [--data-dir .local/evals] [--out evals/results/<timestamp>.json]

Each case is one question about a real arXiv paper. The real tutor (Agent SDK, Claude subscription,
no API key) answers with its real tools on the real PDF; the script then scores the answer: pages
cited against the expected pages, quotes verified against the paper, expected facts present, and,
for a question the paper cannot answer, abstention. Compare prompts, models and limits by running
it again and reading the two reports.
"""

import argparse
import asyncio
import json
import re
import sys
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from veille_reader import agent  # noqa: E402
from veille_reader.citations import parse_citations, verify_citations  # noqa: E402
from veille_reader.events import RunRequest  # noqa: E402
from veille_reader.memory import StoreMemory  # noqa: E402
from veille_reader.paper import PaperError, load_paper  # noqa: E402
from veille_reader.pdf import Fetcher, PdfError, default_fetcher, ensure_pdf  # noqa: E402
from veille_reader.storage import ReaderStore  # noqa: E402
from veille_reader.tools import PaperTools  # noqa: E402

DEFAULT_CASES = ROOT / "evals" / "reader_cases.json"
DEFAULT_DATA_DIR = ROOT / ".local" / "evals"
RESULTS_DIR = ROOT / "evals" / "results"

# "the paper does not say / cover / report", "I cannot tell", "it doesn't mention"; a bare "not"
# or "no" is too loose (an answer can contain them while still giving a figure).
_HEDGE = re.compile(
    r"\b(?:does\s+not|do\s+not|did\s+not|doesn['’]t|didn['’]t|is\s+not|isn['’]t|was\s+not)\s+"
    r"(?:\w+\s+){0,3}?(?:say|cover|report|mention|contain|include|address|discuss|evaluate|"
    r"state|give|provide|specify|appear|answer|test|measure)"
    r"|\b(?:cannot|can['’]t|could\s+not|couldn['’]t)\s+(?:\w+\s+){0,2}?(?:tell|say|find|answer)"
    r"|\bno\s+(?:mention|information|score|result|answer)\b"
    r"|\bnot\s+(?:covered|mentioned|reported|discussed|addressed|evaluated|included)\b",
    re.I,
)

Runner = Callable[[RunRequest], object]


# --- metrics (pure) ----------------------------------------------------------------------
def page_scores(cited: list[int], expected: list[int]) -> tuple[float, float]:
    """(precision, recall) of the cited pages; 1.0 where there is nothing to be wrong about.

    `expected` lists the pages where the answer can be found: any one of them is a good source, so
    recall is 1.0 when at least one cited page is among them (not all of them), else 0.0.
    """
    got, want = set(cited), set(expected)
    hit = len(got & want)
    precision = hit / len(got) if got else (1.0 if not want else 0.0)
    recall = (1.0 if hit else 0.0) if want else 1.0
    return precision, recall


def verified_rate(verdicts: list[dict]) -> float | None:
    """Verified citations over the citations that carry a quote (None when none does)."""
    quoted = [v for v in verdicts if v.get("quote")]
    if not quoted:
        return None
    return sum(1 for v in quoted if v["status"] == "verified") / len(quoted)


def facts_found(answer: str, facts: list[str]) -> float | None:
    if not facts:
        return None
    text = answer.casefold()
    return sum(1 for fact in facts if fact.casefold() in text) / len(facts)


def abstained_ok(answer: str, cited: list[int]) -> bool:
    """The tutor said it cannot tell and cited nothing."""
    return not cited and bool(_HEDGE.search(answer))


def _mean(values: list[float | None]) -> float | None:
    real = [v for v in values if v is not None]
    return sum(real) / len(real) if real else None


# --- selection ---------------------------------------------------------------------------
def select_cases(
    cases: list[dict], limit: int | None = None, ids: list[str] | None = None
) -> list[dict]:
    if ids:
        known = {c["id"] for c in cases}
        missing = [i for i in ids if i not in known]
        if missing:
            raise ValueError(f"unknown case id(s): {', '.join(missing)}")
        cases = [c for c in cases if c["id"] in set(ids)]
    return cases[:limit] if limit is not None else list(cases)


# --- one case ----------------------------------------------------------------------------
def _failed(case: dict, error: str, cost: float | None = None, duration: int | None = None) -> dict:
    return {
        "id": case["id"],
        "arxiv": case["arxiv"],
        "answerable": case.get("answerable", True),
        "answer": "",
        "cited_pages": [],
        "verdicts": [],
        "page_precision": None,
        "page_recall": None,
        "verified_rate": None,
        "facts_found": None,
        "abstained_ok": None,
        "tool_calls": 0,
        "cost_usd": cost,
        "duration_ms": duration,
        "error": error,
    }


def score_case(case: dict, answer: str, paper_pages: list[str], outline: list) -> dict:
    """The metrics of one finished answer (no I/O)."""
    verdicts = verify_citations(paper_pages, outline, parse_citations(answer))
    cited = sorted({v["page"] for v in verdicts})
    precision, recall = page_scores(cited, case["expected_pages"])
    answerable = case.get("answerable", True)
    return {
        "answerable": answerable,
        "answer": answer,
        "cited_pages": cited,
        "verdicts": verdicts,
        "page_precision": precision,
        "page_recall": recall,
        "verified_rate": verified_rate(verdicts),
        "facts_found": facts_found(answer, case["expected_facts"]),
        "abstained_ok": None if answerable else abstained_ok(answer, cited),
    }


async def _collect(runner: Runner, request: RunRequest) -> dict:
    text, tool_calls, cost, duration, error = [], 0, None, None, None
    started = time.monotonic()
    async for event in runner(request):  # type: ignore[attr-defined]
        kind = event.get("type")
        if kind == "text_delta":
            text.append(event["text"])
        elif kind == "tool_use":
            tool_calls += 1
        elif kind in ("done", "error"):
            usage = event.get("usage") or {}
            if usage.get("cost_usd") is not None:
                cost = usage["cost_usd"]
            if kind == "done":
                duration = event.get("duration_ms")
            else:
                error = f"{event.get('kind')}: {event.get('message')}"
    if duration is None:
        duration = int((time.monotonic() - started) * 1000)
    return {
        "answer": "".join(text).strip(),
        "tool_calls": tool_calls,
        "cost_usd": cost,
        "duration_ms": duration,
        "error": error,
    }


def _run_case(case: dict, runner: Runner, store: ReaderStore, fetch: Fetcher) -> dict:
    item_id = f"eval-{case['arxiv']}"
    url = f"https://arxiv.org/abs/{case['arxiv']}"
    try:
        path = ensure_pdf(store, item_id, url, fetch)
        paper = load_paper(store, item_id, path)
    except (PdfError, PaperError) as exc:
        return _failed(case, f"pdf: {getattr(exc, 'reason', None) or exc}")
    # a throw-away memory: notes the tutor wrote for an earlier case never reach this one
    for note in store.memory_notes(item_id):
        store.delete_memory_note(item_id, note["id"])
    tools = PaperTools(paper, [], StoreMemory(store, item_id))
    item = {
        "id": item_id,
        "title": case.get("title") or f"arXiv {case['arxiv']}",
        "hook": "",
        "brief": "",
        "url": url,
        "type": "paper",
    }
    request = RunRequest(item=item, question=case["question"], paper_tools=tools, notes=[])
    try:
        run = asyncio.run(_collect(runner, request))
    except Exception as exc:  # noqa: BLE001 - one broken case must not stop the others
        return _failed(case, f"{type(exc).__name__}: {exc}")
    if run["error"]:
        return _failed(case, run["error"], run["cost_usd"], run["duration_ms"])
    scored = score_case(case, run["answer"], paper.pages, paper.outline)
    return {
        "id": case["id"],
        "arxiv": case["arxiv"],
        **scored,
        "tool_calls": run["tool_calls"],
        "cost_usd": run["cost_usd"],
        "duration_ms": run["duration_ms"],
        "error": None,
    }


# --- the run -----------------------------------------------------------------------------
def totals_of(results: list[dict]) -> dict:
    ok = [r for r in results if not r["error"]]
    not_answerable = [r for r in ok if not r["answerable"]]
    costs = [r["cost_usd"] for r in results if r["cost_usd"] is not None]
    return {
        "cases": len(results),
        "errors": len(results) - len(ok),
        "page_precision": _mean([r["page_precision"] for r in ok]),
        "page_recall": _mean([r["page_recall"] for r in ok]),
        "verified_rate": _mean([r["verified_rate"] for r in ok]),
        "facts_found": _mean([r["facts_found"] for r in ok]),
        "abstention_rate": _mean([float(r["abstained_ok"]) for r in not_answerable]),
        "tool_calls": _mean([float(r["tool_calls"]) for r in ok]),
        "cost_usd": sum(costs),
        "duration_ms": _mean([r["duration_ms"] for r in ok]),
    }


def run_eval(
    cases: list[dict],
    runner: Runner,
    fetch: Fetcher,
    data_dir: Path,
    limit: int | None = None,
    ids: list[str] | None = None,
    on_case: Callable[[dict], None] | None = None,
) -> dict:
    """Run the selected cases one after the other; never raises for a single case."""
    selected = select_cases(cases, limit, ids)
    store = ReaderStore(Path(data_dir))
    results = []
    for case in selected:
        result = _run_case(case, runner, store, fetch)
        results.append(result)
        if on_case:
            on_case(result)
    return {"cases": results, "totals": totals_of(results)}


# --- report ------------------------------------------------------------------------------
def _num(value: float | None, digits: int = 2) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def format_report(result: dict) -> str:
    head = (
        "| id | pages | precision | recall | verified | facts | abstained | tools | cost $ | ms "
        "| error |"
    )
    lines = [head, "|---" * 11 + "|"]
    for r in result["cases"]:
        abstained = "-" if r["abstained_ok"] is None else ("yes" if r["abstained_ok"] else "no")
        pages = ",".join(str(p) for p in r["cited_pages"]) or "-"
        error = (r["error"] or "").replace("|", "/").replace("\n", " ")[:80] or "-"
        cost = _num(r["cost_usd"], 3)
        ms = "-" if r["duration_ms"] is None else str(r["duration_ms"])
        lines.append(
            f"| {r['id']} | {pages} | {_num(r['page_precision'])} | {_num(r['page_recall'])} "
            f"| {_num(r['verified_rate'])} | {_num(r['facts_found'])} | {abstained} "
            f"| {r['tool_calls']} | {cost} | {ms} | {error} |"
        )
    t = result["totals"]
    ms = "-" if t["duration_ms"] is None else f"{t['duration_ms']:.0f}"
    lines.append(
        f"| mean | - | {_num(t['page_precision'])} | {_num(t['page_recall'])} "
        f"| {_num(t['verified_rate'])} | {_num(t['facts_found'])} | {_num(t['abstention_rate'])} "
        f"| {_num(t['tool_calls'], 1)} | {t['cost_usd']:.3f} (sum) | {ms} "
        f"| {t['errors']} error(s) |"
    )
    return "\n".join(lines)


# --- command line ------------------------------------------------------------------------
def main(argv: list[str] | None = None, runner: Runner | None = None, fetch: Fetcher | None = None):
    parser = argparse.ArgumentParser(description="Evaluate the reader tutor's citations.")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--ids", help="comma-separated case ids")
    parser.add_argument("--model", help=f"tutor model (default: {agent.MODEL})")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)

    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    ids = [i.strip() for i in args.ids.split(",") if i.strip()] if args.ids else None
    try:
        selected = select_cases(cases, args.limit, ids)
    except ValueError as exc:
        parser.error(str(exc))
    if args.model:
        agent.MODEL = args.model
    if runner is None:
        from veille_llm.llm import LlmError, assert_subscription_auth

        try:
            assert_subscription_auth()
        except LlmError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        runner = agent.sdk_runner
    print(
        f"This run uses your Claude subscription through the Agent SDK (no API key), model "
        f"{agent.MODEL}: {len(selected)} tutor answer(s), each with several tool round trips "
        f"(roughly {len(selected) * 4} model calls)."
    )
    result = run_eval(
        selected,
        runner,
        fetch or default_fetcher,
        args.data_dir,
        on_case=lambda r: print(f"  {r['id']}: {'error' if r['error'] else 'done'}", flush=True),
    )
    result = {
        "model": agent.MODEL,
        "started": datetime.now().isoformat(timespec="seconds"),
        **result,
    }
    out = args.out or RESULTS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print()
    print(format_report(result))
    print(f"\nFull results: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
