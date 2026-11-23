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
import random
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
KINDS = ("choice", "multi", "truefalse", "cloze", "order", "free")
REQUESTABLE = ("any", *KINDS)  # "any": the maker picks the kind that suits the content
MIN_MULTI, MAX_MULTI = 4, 5
MIN_STEPS, MAX_STEPS = 3, 5
MAX_BLANKS = 2
MAX_VARIANTS = 4
MAX_WORD = 60  # one accepted word or phrase of a cloze blank
MAX_GIVEN = 100  # what the user types for one blank
BLANK = "___"
TRUE_FALSE = ["True", "False"]

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


_HIDDEN = "\u2581"  # stands in for a blank while the text is checked for markup (`__` is markup)
_KIND_CHECKS: dict = {}


def _blanks_hidden(raw: object) -> object:
    return raw.replace(BLANK, _HIDDEN) if isinstance(raw, str) else raw


def _index(value: object, size: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < size:
        raise QuizError("an option marked correct is out of range")
    return value


def _options(raw: object, low: int, high: int) -> list[str]:
    if not isinstance(raw, list) or not low <= len(raw) <= high:
        raise QuizError(
            f"needs exactly {low} options" if low == high else f"needs {low} to {high} options"
        )
    clean = [_text(o, "option", MAX_OPTION) for o in raw]
    if len({normalise(o) for o in clean}) != len(clean) or "" in {normalise(o) for o in clean}:
        raise QuizError("the options must be distinct")
    return clean


def _check_choice(raw: dict, spec: dict, question: str) -> None:
    clean = _options(raw.get("options"), N_OPTIONS, N_OPTIONS)
    correct = raw.get("correct")
    if isinstance(correct, bool) or not isinstance(correct, int) or not 0 <= correct < N_OPTIONS:
        raise QuizError("exactly one option must be marked correct")
    if _leaks(question, clean[correct]):
        raise QuizError("the question gives away the answer")
    spec["options"], spec["correct"] = clean, correct


def _check_multi(raw: dict, spec: dict, question: str) -> None:
    clean = _options(raw.get("options"), MIN_MULTI, MAX_MULTI)
    correct = raw.get("correct")
    if not isinstance(correct, list) or not 1 <= len(correct) <= len(clean) - 1:
        raise QuizError("one or more options, but not all, must be marked correct")
    picked = sorted({_index(c, len(clean)) for c in correct})
    if len(picked) != len(correct):
        raise QuizError("the correct options must be distinct")
    if any(_leaks(question, clean[i]) for i in picked):
        raise QuizError("the question gives away the answer")
    spec["options"], spec["correct"] = clean, picked


def _check_truefalse(raw: dict, spec: dict, question: str) -> None:
    correct = raw.get("correct")
    if not isinstance(correct, bool):
        raise QuizError("a true or false quiz needs true or false as its answer")
    spec["options"], spec["correct"] = list(TRUE_FALSE), 0 if correct else 1


def _folded(text: str) -> str:
    """Case, accents, punctuation and spacing folded away, for comparing typed words."""
    base = unicodedata.normalize("NFKD", text).casefold()
    base = "".join(ch for ch in base if not unicodedata.combining(ch))
    return " ".join("".join(ch if ch.isalnum() else " " for ch in base).split())


def _check_cloze(raw: dict, spec: dict, question: str) -> None:
    blanks = question.count(BLANK)
    if not 1 <= blanks <= MAX_BLANKS or "____" in question:
        raise QuizError(f"a cloze quiz needs one or {MAX_BLANKS} blanks ({BLANK})")
    answers = raw.get("answers")
    if not isinstance(answers, list) or len(answers) != blanks:
        raise QuizError("a cloze quiz needs the accepted words of each blank")
    keys = []
    for variants in answers:
        if isinstance(variants, str):
            variants = [variants]
        if not isinstance(variants, list) or not 1 <= len(variants) <= MAX_VARIANTS:
            raise QuizError(f"each blank takes one to {MAX_VARIANTS} accepted answers")
        clean = [_text(v, "accepted answer", MAX_WORD) for v in variants]
        folded = [_folded(v) for v in clean]
        if "" in folded or len(set(folded)) != len(folded):
            raise QuizError("the accepted answers must be distinct words")
        keys.append(clean)
    spec["answers"] = keys


def _check_order(raw: dict, spec: dict, question: str) -> None:
    steps = raw.get("steps")
    if not isinstance(steps, list) or not MIN_STEPS <= len(steps) <= MAX_STEPS:
        raise QuizError(f"an order quiz needs {MIN_STEPS} to {MAX_STEPS} steps")
    clean = [_text(step, "step", MAX_OPTION) for step in steps]
    if len({normalise(step) for step in clean}) != len(clean) or "" in {
        normalise(s) for s in clean
    }:
        raise QuizError("the steps must be distinct")
    shown = list(range(len(clean)))
    while shown == sorted(shown):  # never show the right order
        random.SystemRandom().shuffle(shown)
    spec["steps"], spec["shown"] = clean, shown


def _check_free(raw: dict, spec: dict, question: str) -> None:
    reference = _text(raw.get("reference"), "reference answer", MAX_REFERENCE)
    if _leaks(question, reference):
        raise QuizError("the question gives away the answer")
    spec["reference"] = reference


_KIND_CHECKS.update(
    choice=_check_choice,
    multi=_check_multi,
    truefalse=_check_truefalse,
    cloze=_check_cloze,
    order=_check_order,
    free=_check_free,
)


def validate_quiz(raw: object, pages: list[str], outline: list[tuple[str, int]]) -> dict:
    """The full quiz (key included) or a QuizError. Nothing from `raw` is kept unchecked."""
    if not isinstance(raw, dict):
        raise QuizError("the quiz is not an object")
    kind = raw.get("kind")
    if kind not in KINDS:
        raise QuizError("unknown kind of quiz")
    question = _text(
        _blanks_hidden(raw.get("question")) if kind == "cloze" else raw.get("question"),
        "question",
        MAX_QUESTION,
    )
    if kind == "cloze":
        question = question.replace(_HIDDEN, BLANK)
    if _LEAKY.search(question):
        raise QuizError("the question gives away the answer")
    spec: dict = {"kind": kind, "question": question, "options": None, "correct": None}
    spec["reference"] = None
    _KIND_CHECKS[kind](raw, spec, question)
    spec["explanation"] = _text(raw.get("explanation"), "explanation", MAX_EXPLANATION)
    spec["topic"] = _text(raw.get("topic"), "topic", MAX_TOPIC)
    quoted = raw.get("quote")  # a quote copied across a line break keeps no newline
    page, quote = (
        raw.get("page"),
        _text(
            " ".join(quoted.split()) if isinstance(quoted, str) else quoted,
            "quote",
            MAX_QUOTE_CHARS,
        ),
    )
    if isinstance(page, bool) or not isinstance(page, int):
        raise QuizError("page must be a number")
    verdict = _verify(pages, outline, [Citation(page, quote, 0, 0)])[0]
    if verdict["status"] not in ("verified", "wrong_page"):
        raise QuizError("the quote is not in the paper")
    spec["page"] = int(verdict.get("found_page") or page)
    spec["quote"] = verdict["quote"]  # without the entities of the model's escaped view
    spec["section"] = verdict.get("section")
    return spec


def public_quiz(quiz_id: int, spec: dict) -> dict:
    """What the client may see before it answers: the question and the options only."""
    content: dict = {"quiz_id": quiz_id, "kind": spec["kind"], "question": spec["question"]}
    kind = spec["kind"]
    if kind in ("choice", "multi", "truefalse"):
        content["options"] = list(spec["options"])
    elif kind == "cloze":
        content["blanks"] = len(spec["answers"])
    elif kind == "order":
        content["items"] = [spec["steps"][i] for i in spec["shown"]]
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
    kind = spec["kind"]
    if kind in ("choice", "truefalse"):
        result["choice"] = int(answer["answer"])
        result["correct_choice"] = spec["correct"]
    elif kind == "multi":
        result["choices"] = json.loads(answer["answer"])
        result["correct_choices"] = spec["correct"]
    elif kind == "cloze":
        words = json.loads(answer["answer"])
        result["words"] = words
        result["answers"] = [variants[0] for variants in spec["answers"]]
        result["blank_ok"] = [_blank_ok(w, v) for w, v in zip(words, spec["answers"], strict=True)]
    elif kind == "order":
        result["order"] = json.loads(answer["answer"])
        result["steps"] = list(spec["steps"])
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
    kind: str = "any",
    focus: str = "",
    recent: list[str] | None = None,
) -> dict:
    """Make, validate and store one quiz, and add its card to the conversation."""
    if kind not in REQUESTABLE:
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
            if kind != "any" and spec["kind"] != kind:
                raise QuizError(f"a {spec['kind']} quiz was made, not a {kind} one")
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


def _blank_ok(given: str, accepted: list[str]) -> bool:
    return _folded(given) in {_folded(v) for v in accepted}


def _is_ints(values: object, low: int, high: int) -> bool:
    return (
        isinstance(values, list)
        and low <= len(values) <= high
        and all(isinstance(v, int) and not isinstance(v, bool) for v in values)
    )


def _exact(spec: dict, given: dict) -> tuple[bool, str]:
    """Grade a closed answer without the model: (correct, the answer as stored) or bad_answer."""
    kind = spec["kind"]
    choice, choices, words, order = (given.get(k) for k in ("choice", "choices", "words", "order"))
    if sum(v is not None for v in given.values()) != 1:
        raise AnswerError("bad_answer")
    if kind in ("choice", "truefalse"):
        if not _is_ints([choice], 1, 1) or not 0 <= choice < len(spec["options"]):
            raise AnswerError("bad_answer")
        return choice == spec["correct"], str(choice)
    if kind == "multi":
        size = len(spec["options"])
        if not _is_ints(choices, 1, size) or len(set(choices)) != len(choices):
            raise AnswerError("bad_answer")
        if not all(0 <= c < size for c in choices):
            raise AnswerError("bad_answer")
        ticked = sorted(choices)
        return ticked == spec["correct"], json.dumps(ticked)
    if kind == "cloze":
        keys = spec["answers"]
        if not isinstance(words, list) or len(words) != len(keys):
            raise AnswerError("bad_answer")
        if not all(isinstance(w, str) and 0 < len(w.strip()) <= MAX_GIVEN for w in words):
            raise AnswerError("bad_answer")
        words = [w.strip() for w in words]
        right = all(_blank_ok(w, k) for w, k in zip(words, keys, strict=True))
        return right, json.dumps(words)
    # order: the positions in the shown list, in the order the user chose
    size = len(spec["steps"])
    if not _is_ints(order, size, size) or sorted(order) != list(range(size)):
        raise AnswerError("bad_answer")
    return [spec["shown"][i] for i in order] == list(range(size)), json.dumps(order)


async def answer_quiz(
    store: ReaderStore,
    grader: Grader | None,
    item: dict,
    quiz: dict,
    choice: int | None,
    text: str | None,
    *,
    choices: list[int] | None = None,
    words: list[str] | None = None,
    order: list[int] | None = None,
) -> dict:
    """Record the answer of a quiz and return the verdict, explanation and citation."""
    if quiz["answer"] is not None:
        raise AnswerError("already_answered")
    spec = quiz["spec"]
    reasoning = ""
    if spec["kind"] != "free":
        if text is not None:
            raise AnswerError("bad_answer")
        given_by_kind = {"choice": choice, "choices": choices, "words": words, "order": order}
        correct, given = _exact(spec, given_by_kind)
    else:
        given = (text or "").strip()
        if choice is not None or choices or words or order or not given or len(given) > MAX_ANSWER:
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
            store, maker, item_id, item, cid, paper, "any", focus, recent_turns(store, cid)
        )
    except QuizError as exc:
        # a notice, not a tutor turn: it never goes into the model's history
        store.add_message(cid, "system", "notice", {"text": f"I could not start the quiz: {exc}."})
