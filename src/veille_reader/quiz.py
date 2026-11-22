"""Understanding checks: short quizzes on the paper, kept and graded on the server.

A quiz is made by a tool-free structured generation call (an injectable `QuizMaker`), validated,
checked against the text of the paper and stored with its answer key. The client only ever gets the
question and the options; the right answer, the explanation and the quote stay on the server until
the user has answered. Free answers are graded by a second tool-free call (an injectable `Grader`).
Everything the model returns is untrusted JSON: it is validated, never executed or rendered as HTML.
"""

import asyncio
import json
import logging
import re
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from veille_reader.citations import MAX_QUOTE_CHARS, MIN_QUOTE_CHARS, Citation, normalise
from veille_reader.citations import verify_citations as _verify
from veille_reader.memory import MAX_NOTES, StoreMemory
from veille_reader.storage import ReaderStore
from veille_reader.tools import ToolError

log = logging.getLogger(__name__)

N_OPTIONS = 4
MAX_QUESTION = 400
MAX_OPTION = 200
MAX_EXPLANATION = 800
MAX_REFERENCE = 600
MAX_TOPIC = 80
MAX_REASONING = 800
MAX_ANSWER = 1500  # what the user types for a free answer
MAX_RAW = 20_000  # the model's whole JSON
MAX_FOCUS = 200
MAKE_TIMEOUT = 120.0  # seconds
GRADE_TIMEOUT = 60.0
ATTEMPTS = 2
NOTE_CHARS = 500
KINDS = ("choice", "free")

# What the tutor writes at the end of its answer to start a quiz (the user asked, or accepted its
# offer). The text after the colon is the focus; it may be empty. The web hides it.
MARKER = re.compile(r"\[\[quiz:([^\]\n]{0,200})\]\]")

QUIZ_PROMPT = (
    " You can also run a short quiz. When the user asks for a quiz or says yes to your offer of "
    "one, end your answer with the line [[quiz: topic]] (the part of the paper to ask about, or "
    "nothing after the colon for the whole paper): the app then shows the question card. Do not "
    "write the questions yourself and never reveal an answer before the user has replied. You may "
    "offer a quiz, in one short sentence, after explaining a hard part."
)


class QuizError(Exception):
    """A quiz that cannot be made or used; the message is safe to show."""


class AnswerError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class QuizRequest:
    item: dict
    pages: list[str]
    kind: str
    focus: str = ""
    recent: list[str] = field(default_factory=list)  # the part just discussed
    avoid: list[str] = field(default_factory=list)  # questions already asked on this paper


@dataclass
class GradeRequest:
    item: dict
    question: str
    reference: str
    quote: str
    page_text: str
    answer: str


QuizMaker = Callable[[QuizRequest], Awaitable[str]]
Grader = Callable[[GradeRequest], Awaitable[str]]

_MARKUP = re.compile(r"[<>`]|\]\(|\[\[|\*\*|__")
_LEAKY = re.compile(
    r"\b(correct|right)\s+(answer|option|choice)\b|\bthe\s+answer\s+(is|are)\b|\banswer\s*:",
    re.I,
)


def find_marker(text: str) -> str | None:
    """The focus of a quiz the tutor asked for at the end of its answer (None: no request)."""
    found = MARKER.findall(text or "")
    return found[-1].strip()[:MAX_FOCUS] if found else None


def _text(raw: object, name: str, limit: int, required: bool = True) -> str:
    if not isinstance(raw, str):
        if required or raw is not None:
            raise QuizError(f"{name} must be text")
        return ""
    value = raw.strip()
    if required and not value:
        raise QuizError(f"{name} is empty")
    if len(value) > limit:
        raise QuizError(f"{name} is too long")
    if any(unicodedata.category(ch) == "Cc" for ch in value):
        raise QuizError(f"{name} has control characters")
    if _MARKUP.search(value):
        raise QuizError(f"{name} has markup")
    return value


def parse_json(text: str) -> object:
    """The JSON object in a model reply (it may add a sentence or a code fence around it)."""
    if not isinstance(text, str) or len(text) > MAX_RAW:
        raise QuizError("the reply is not usable")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise QuizError("the reply has no JSON object")
    try:
        return json.loads(text[start : end + 1])
    except ValueError:
        raise QuizError("the reply is not valid JSON") from None


def _leaks(question: str, secret: str) -> bool:
    flat, needle = normalise(question), normalise(secret)
    return len(needle) >= MIN_QUOTE_CHARS and needle in flat


def validate_quiz(raw: object, pages: list[str], outline: list[tuple[str, int]]) -> dict:
    """The full quiz (key included) or a QuizError. Nothing from `raw` is kept unchecked."""
    if not isinstance(raw, dict):
        raise QuizError("the quiz is not an object")
    kind = raw.get("kind")
    if kind not in KINDS:
        raise QuizError("unknown kind of quiz")
    question = _text(raw.get("question"), "question", MAX_QUESTION)
    if _LEAKY.search(question):
        raise QuizError("the question gives away the answer")
    spec: dict = {"kind": kind, "question": question, "options": None, "correct": None}
    spec["reference"] = None
    if kind == "choice":
        options = raw.get("options")
        if not isinstance(options, list) or len(options) != N_OPTIONS:
            raise QuizError(f"a choice quiz needs exactly {N_OPTIONS} options")
        clean = [_text(o, "option", MAX_OPTION) for o in options]
        if len({normalise(o) for o in clean}) != N_OPTIONS or "" in {normalise(o) for o in clean}:
            raise QuizError("the options must be distinct")
        correct = raw.get("correct")
        if isinstance(correct, bool) or not isinstance(correct, int) or not 0 <= correct < 4:
            raise QuizError("exactly one option must be marked correct")
        if _leaks(question, clean[correct]):
            raise QuizError("the question gives away the answer")
        spec["options"], spec["correct"] = clean, correct
    else:
        reference = _text(raw.get("reference"), "reference answer", MAX_REFERENCE)
        if _leaks(question, reference):
            raise QuizError("the question gives away the answer")
        spec["reference"] = reference
    spec["explanation"] = _text(raw.get("explanation"), "explanation", MAX_EXPLANATION)
    spec["topic"] = _text(raw.get("topic"), "topic", MAX_TOPIC)
    page, quote = raw.get("page"), _text(raw.get("quote"), "quote", MAX_QUOTE_CHARS)
    if isinstance(page, bool) or not isinstance(page, int):
        raise QuizError("page must be a number")
    verdict = _verify(pages, outline, [Citation(page, quote, 0, 0)])[0]
    if verdict["status"] not in ("verified", "wrong_page"):
        raise QuizError("the quote is not in the paper")
    spec["page"] = int(verdict.get("found_page") or page)
    spec["quote"] = quote
    spec["section"] = verdict.get("section")
    return spec


def public_quiz(quiz_id: int, spec: dict) -> dict:
    """What the client may see before it answers: the question and the options only."""
    content: dict = {"quiz_id": quiz_id, "kind": spec["kind"], "question": spec["question"]}
    if spec["kind"] == "choice":
        content["options"] = list(spec["options"])
    return content


def _score(store: ReaderStore, quiz: dict) -> dict:
    session = quiz["conversation_id"]
    return {
        "paper": store.quiz_score(quiz["item_id"]),
        "session": store.quiz_score(quiz["item_id"], session) if session is not None else None,
    }


def result_of(store: ReaderStore, quiz: dict) -> dict | None:
    """The verdict, explanation and citation of an answered quiz (None while unanswered)."""
    answer = quiz["answer"]
    if answer is None:
        return None
    spec = quiz["spec"]
    result = {
        "correct": answer["correct"],
        "explanation": spec["explanation"],
        "quote": spec["quote"],
        "page": spec["page"],
        "section": spec["section"],
        "answered_at": answer["answered_at"],
        "score": _score(store, quiz),
    }
    if spec["kind"] == "choice":
        result["choice"] = int(answer["answer"])
        result["correct_choice"] = spec["correct"]
    else:
        result["answer"] = answer["answer"]
        result["reference"] = spec["reference"]
        result["reasoning"] = answer["reasoning"]
    return result


def view_of(store: ReaderStore, quiz: dict) -> dict:
    view = public_quiz(quiz["id"], quiz["spec"])
    result = result_of(store, quiz)
    if result is not None:
        view["result"] = result
    return view


def with_results(store: ReaderStore, item_id: str, messages: list[dict]) -> list[dict]:
    """Stored messages for the client: answered quizzes carry their result, others nothing more."""
    out = []
    for message in messages:
        if message["kind"] == "quiz":
            quiz = store.quiz(item_id, int(message["content"].get("quiz_id", 0)))
            if quiz is not None:
                message = {**message, "content": view_of(store, quiz)}
        out.append(message)
    return out


async def create_quiz(
    store: ReaderStore,
    maker: QuizMaker,
    item_id: str,
    item: dict,
    cid: int,
    paper: object,
    kind: str = "choice",
    focus: str = "",
    recent: list[str] | None = None,
) -> dict:
    """Make, validate and store one quiz, and add its card to the conversation."""
    if kind not in KINDS:
        raise QuizError("unknown kind of quiz")
    pages, outline = paper.pages, paper.outline  # type: ignore[attr-defined]
    if not any(p.strip() for p in pages):
        raise QuizError("the paper has no text to ask about")
    avoid = [h["question"] for h in store.quiz_history(item_id)[:10]]
    request = QuizRequest(item, pages, kind, focus[:MAX_FOCUS], list(recent or []), avoid)
    failure = "the quiz could not be made"
    for _ in range(ATTEMPTS):
        try:
            reply = await asyncio.wait_for(maker(request), MAKE_TIMEOUT)
            spec = validate_quiz(parse_json(reply), pages, outline)
        except QuizError as exc:
            failure = f"the quiz could not be made ({exc})"
            continue
        except Exception as exc:  # noqa: BLE001 - the model call failed or timed out
            log.warning("quiz not made: %s", type(exc).__name__)
            failure = "the quiz could not be made, try again"
            continue
        qid = store.add_quiz(item_id, cid, spec)
        return store.add_message(cid, "system", "quiz", public_quiz(qid, spec))
    raise QuizError(failure)


def _weak_point(store: ReaderStore, item_id: str, spec: dict) -> None:
    """Tell the tutor, through a session note, what the user got wrong (never fails the answer)."""
    head = f"Quiz: got wrong on {spec['topic']} (p.{spec['page']})."
    note = f"{head} {spec['explanation']}"[:NOTE_CHARS]
    notes = store.memory_notes(item_id)
    if len(notes) >= MAX_NOTES or any(n["text"].startswith(head) for n in notes):
        return
    try:
        StoreMemory(store, item_id).write(note)
    except ToolError:
        pass


async def _grade(grader: Grader, request: GradeRequest) -> tuple[bool, str]:
    try:
        reply = await asyncio.wait_for(grader(request), GRADE_TIMEOUT)
        raw = parse_json(reply)
        if not isinstance(raw, dict) or not isinstance(raw.get("correct"), bool):
            raise QuizError("no verdict")
        return raw["correct"], _text(raw.get("reasoning"), "reasoning", MAX_REASONING)
    except Exception as exc:  # noqa: BLE001 - the answer is not recorded, the user can retry
        log.warning("grading failed: %s", type(exc).__name__)
        raise AnswerError("grader_failed") from None


async def answer_quiz(
    store: ReaderStore,
    grader: Grader | None,
    item: dict,
    quiz: dict,
    choice: int | None,
    text: str | None,
) -> dict:
    """Record the answer of a quiz and return the verdict, explanation and citation."""
    if quiz["answer"] is not None:
        raise AnswerError("already_answered")
    spec = quiz["spec"]
    if spec["kind"] == "choice":
        if text is not None or choice is None or not 0 <= choice < len(spec["options"]):
            raise AnswerError("bad_answer")
        correct, reasoning, given = choice == spec["correct"], "", str(choice)
    else:
        given = (text or "").strip()
        if choice is not None or not given or len(given) > MAX_ANSWER:
            raise AnswerError("bad_answer")
        if grader is None:
            raise AnswerError("no_grader")
        cached = store.paper_text(quiz["item_id"])
        pages = cached["pages"] if cached else []
        page_text = pages[spec["page"] - 1] if 0 < spec["page"] <= len(pages) else spec["quote"]
        correct, reasoning = await _grade(
            grader,
            GradeRequest(
                item, spec["question"], spec["reference"], spec["quote"], page_text[:6000], given
            ),
        )
    if not store.add_quiz_answer(quiz["id"], given, correct, reasoning):
        raise AnswerError("already_answered")
    if not correct:
        _weak_point(store, quiz["item_id"], spec)
    result = result_of(store, store.quiz(quiz["item_id"], quiz["id"]))
    assert result is not None  # just recorded
    return result


def recent_turns(store: ReaderStore, cid: int, limit: int = 6) -> list[str]:
    """The last few turns of a conversation, as text: the part a quiz may be about."""
    from veille_reader.compaction import turn_of

    turns = [turn_of(m) for m in store.messages(cid) if m["role"] in ("user", "assistant")]
    lines = []
    for turn in turns[-limit:]:
        who = "Student" if turn["role"] == "user" else "Tutor"
        lines.append(f"{who}: {turn['text'][:1500]}")
    return lines


async def quiz_after_turn(
    store: ReaderStore,
    maker: QuizMaker | None,
    item_id: str,
    item: dict,
    cid: int,
    paper: object,
    answer: str,
) -> None:
    """When the tutor ended its answer with the quiz marker, add the question card after it."""
    focus = find_marker(answer)
    if focus is None:
        return
    try:
        if maker is None or paper is None:
            raise QuizError("the quiz could not be made (the paper is not available)")
        await create_quiz(
            store, maker, item_id, item, cid, paper, "choice", focus, recent_turns(store, cid)
        )
    except QuizError as exc:
        store.add_message(
            cid,
            "assistant",
            "assistant",
            {
                "blocks": [],
                "answer": f"I could not start the quiz: {exc}.",
                "stopped": False,
                "duration_ms": 0,
            },
        )
