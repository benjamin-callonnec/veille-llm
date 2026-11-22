import importlib.util
import json
import sys
from pathlib import Path

import pytest

from veille_reader import events

from .pdf_factory import make_pdf

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("eval_reader", ROOT / "scripts" / "eval_reader.py")
ev = importlib.util.module_from_spec(spec)
sys.modules["eval_reader"] = ev
spec.loader.exec_module(ev)

CASES_FILE = ROOT / "evals" / "reader_cases.json"
PDF = make_pdf(["Attention is all you need, page one", "Second page says heads 8 and learned bias"])


# --- the cases file ----------------------------------------------------------------------
def test_the_cases_file_is_valid():
    cases = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    assert len(cases) == 10
    assert len({c["id"] for c in cases}) == 10
    assert {c["arxiv"] for c in cases} == {"1706.03762", "1810.04805"}
    for case in cases:
        assert case["question"].strip()
        assert all(isinstance(p, int) and p >= 1 for p in case["expected_pages"])
        if case.get("answerable", True):
            assert case["expected_pages"]
            assert case["expected_facts"]
        else:
            assert case["expected_pages"] == [] and case["expected_facts"] == []
    assert sum(1 for c in cases if c.get("answerable") is False) == 1


# --- metrics -----------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("cited", "expected", "precision", "recall"),
    [
        ([], [], 1.0, 1.0),
        ([3], [], 0.0, 1.0),
        ([], [3], 0.0, 0.0),
        ([3, 4], [3], 0.5, 1.0),
        ([3], [3, 4], 1.0, 0.5),
        ([5], [3], 0.0, 0.0),
    ],
)
def test_page_precision_and_recall(cited, expected, precision, recall):
    assert ev.page_scores(cited, expected) == (precision, recall)


def test_verified_rate_counts_only_citations_that_carry_a_quote():
    verdicts = [
        {"page": 1, "quote": "a long enough quote", "status": "verified"},
        {"page": 2, "quote": "another quote here", "status": "unverified"},
        {"page": 3, "quote": None, "status": "page_only"},
    ]
    assert ev.verified_rate(verdicts) == 0.5
    assert ev.verified_rate([verdicts[2]]) is None
    assert ev.verified_rate([]) is None


def test_facts_found_is_case_insensitive_and_a_fraction():
    assert ev.facts_found("The BLEU was 28.4 with EIGHT heads", ["28.4", "8 heads"]) == 0.5
    assert ev.facts_found("28.4 and 8 Heads", ["28.4", "8 heads"]) == 1.0
    assert ev.facts_found("anything", []) is None


def test_abstention_needs_no_citation_and_a_hedge():
    assert ev.abstained_ok("The paper does not say.", []) is True
    assert ev.abstained_ok("I cannot tell from this paper.", []) is True
    assert ev.abstained_ok("It does not say [p.3].", [3]) is False
    assert ev.abstained_ok("It scores 90.", []) is False


# --- selection ---------------------------------------------------------------------------
CASES = [
    {
        "id": "one",
        "arxiv": "1706.03762",
        "question": "q1",
        "expected_pages": [2],
        "expected_facts": ["heads 8"],
    },
    {
        "id": "two",
        "arxiv": "1706.03762",
        "question": "q2",
        "expected_pages": [],
        "expected_facts": [],
        "answerable": False,
    },
    {
        "id": "three",
        "arxiv": "1810.04805",
        "question": "q3",
        "expected_pages": [1],
        "expected_facts": ["x"],
    },
]


def test_limit_and_ids_select_cases():
    assert [c["id"] for c in ev.select_cases(CASES, limit=2)] == ["one", "two"]
    assert [c["id"] for c in ev.select_cases(CASES, ids=["three", "one"])] == ["one", "three"]
    assert [c["id"] for c in ev.select_cases(CASES, ids=["two", "three"], limit=1)] == ["two"]
    with pytest.raises(ValueError, match="nope"):
        ev.select_cases(CASES, ids=["nope"])


# --- run_eval ----------------------------------------------------------------------------
def good_runner(seen):
    async def runner(request):
        seen.append(request)
        page = request.paper_tools.load_artifact("pages", 2, 2)
        assert "heads 8" in page
        yield events.tool_use("t1", "load_artifact", {"kind": "pages"})
        yield events.tool_result("t1", "ok", False)
        if "q2" in request.question:
            yield events.text_delta("The paper does not say.")
        else:
            yield events.text_delta('Heads 8 [p.2 "Second page says heads 8"] and [p.1].')
        yield events.done(1234, {"input_tokens": 1, "output_tokens": 2, "cost_usd": 0.25})

    return runner


def test_run_eval_end_to_end_with_a_fake_runner_and_fake_fetch(tmp_path):
    seen, fetched = [], []

    def fetch(url):
        fetched.append(url)
        return PDF

    result = ev.run_eval(CASES[:2], good_runner(seen), fetch, tmp_path)
    assert fetched == ["https://arxiv.org/pdf/1706.03762"]  # one download for two cases
    assert len(seen) == 2 and seen[0].notes == []
    first, second = result["cases"]
    assert first["cited_pages"] == [1, 2]
    assert first["page_precision"] == 0.5 and first["page_recall"] == 1.0
    assert first["verified_rate"] == 1.0
    assert first["facts_found"] == 1.0
    assert first["tool_calls"] == 1 and first["cost_usd"] == 0.25
    assert first["duration_ms"] == 1234 and first["error"] is None
    assert first["abstained_ok"] is None
    assert second["abstained_ok"] is True and second["cited_pages"] == []
    assert second["page_precision"] == 1.0
    totals = result["totals"]
    assert totals["cases"] == 2 and totals["errors"] == 0
    assert totals["cost_usd"] == 0.5
    assert totals["page_precision"] == 0.75  # mean of 0.5 and 1.0
    assert totals["abstention_rate"] == 1.0


def test_an_error_in_the_runner_is_recorded_and_the_others_still_run(tmp_path):
    async def runner(request):
        if "q1" in request.question:
            raise RuntimeError("boom")
        yield events.text_delta("Heads 8 [p.2].")
        yield events.done(5, {"cost_usd": 0.1})

    result = ev.run_eval(CASES, runner, lambda url: PDF, tmp_path)
    errors = [c["error"] for c in result["cases"]]
    assert "boom" in errors[0] and errors[1:] == [None, None]
    assert result["cases"][0]["page_precision"] is None
    assert result["totals"]["errors"] == 1
    assert result["cases"][2]["cited_pages"] == [2]


def test_an_error_event_and_a_failed_download_are_recorded(tmp_path):
    async def runner(request):
        yield events.error("limit", "too many steps", {"cost_usd": 0.4})

    def fetch(url):
        if "1810" in url:
            raise OSError("offline")
        return PDF

    result = ev.run_eval([CASES[0], CASES[2]], runner, fetch, tmp_path)
    assert "too many steps" in result["cases"][0]["error"]
    assert result["cases"][0]["cost_usd"] == 0.4
    assert "pdf" in result["cases"][1]["error"].lower()


def test_run_eval_selects_with_limit_and_ids(tmp_path):
    runner = good_runner([])
    assert len(ev.run_eval(CASES, runner, lambda url: PDF, tmp_path, limit=1)["cases"]) == 1
    picked = ev.run_eval(CASES[:2], runner, lambda url: PDF, tmp_path, ids=["two"])
    assert [c["id"] for c in picked["cases"]] == ["two"]


# --- report ------------------------------------------------------------------------------
def test_the_report_is_a_markdown_table_with_totals(tmp_path):
    result = ev.run_eval(CASES[:2], good_runner([]), lambda url: PDF, tmp_path)
    text = ev.format_report(result)
    lines = text.splitlines()
    assert lines[0].startswith("| id |") and lines[1].startswith("|---")
    assert any(line.startswith("| one |") for line in lines)
    assert "| mean |" in text or "| **mean** |" in text
    assert "0.50" in text  # the precision of case one


def test_the_report_marks_errors_and_missing_values(tmp_path):
    async def runner(request):
        raise RuntimeError("boom")
        yield  # pragma: no cover

    text = ev.format_report(ev.run_eval(CASES[:1], runner, lambda url: PDF, tmp_path))
    assert "boom" in text and "-" in text


# --- command line ------------------------------------------------------------------------
def test_main_writes_the_json_and_prints_the_table(tmp_path, capsys):
    cases = tmp_path / "cases.json"
    cases.write_text(json.dumps(CASES), encoding="utf-8")
    out = tmp_path / "res" / "run.json"
    code = ev.main(
        [
            "--cases",
            str(cases),
            "--limit",
            "1",
            "--data-dir",
            str(tmp_path / "d"),
            "--out",
            str(out),
        ],
        runner=good_runner([]),
        fetch=lambda url: PDF,
    )
    assert code == 0
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert [c["id"] for c in saved["cases"]] == ["one"]
    assert saved["model"]
    captured = capsys.readouterr().out
    assert "subscription" in captured and "| one |" in captured
