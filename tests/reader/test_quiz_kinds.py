"""The other quiz formats: multi, truefalse, cloze, order (graded without the model)."""

import asyncio
import json

import pytest

from veille_reader.paper import PaperText
from veille_reader.quiz import (
    AnswerError,
    QuizError,
    QuizRequest,
    answer_quiz,
    create_quiz,
    public_quiz,
    validate_quiz,
)
from veille_reader.quiz_agent import maker_prompt
from veille_reader.storage import ReaderStore

from .test_quiz import (
    GOOD,
    ITEMS,
    OUTLINE,
    PAGES,
    SECRET,
    FakeGrader,
    Maker,
    cid_of,
    client_for,
)
from .test_quiz import (
    make as _make,
)

BASE = {
    "explanation": f"Heads cover subspaces. {SECRET}",
    "page": 2,
    "quote": "each head attend to a different subspace",
    "topic": "heads",
}
MULTI = {
    **BASE,
    "kind": "multi",
    "question": "Which statements about multi head attention hold? Select all that apply.",
    "options": [
        "Heads see different subspaces",
        "Heads share one subspace",
        "It is parallel",
        "x4",
    ],
    "correct": [0, 2],
}
TF = {**BASE, "kind": "truefalse", "question": "Each head attends to the same subspace.",
      "correct": False}  # fmt: skip
CLOZE = {
    **BASE,
    "kind": "cloze",
    "question": "Multi head attention lets each head attend to a different ___ of the input.",
    "answers": [["subspace", "sub-space", "Sous-espace"]],
}
CLOZE2 = {
    **CLOZE,
    "question": "Each ___ attends to a different ___ of the input.",
    "answers": [["head"], ["subspace"]],
}
ORDER = {
    **BASE,
    "kind": "order",
    "question": "Put the steps of the method in order.",
    "steps": ["Split the input", "Project each head", "Attend per head", "Concatenate"],
}
KEYS = {  # what must never leave the server before the answer, per kind
    "multi": ['"correct":[', '"correct_choices"', SECRET, "Heads cover"],
    "truefalse": ['"correct":true', '"correct":false', '"correct_choice"', SECRET],
    "cloze": ['"answers"', "sub-space", "Sous-espace", SECRET],
    "order": ['"steps"', '"shown"', SECRET],
}
SPECS = {"multi": MULTI, "truefalse": TF, "cloze": CLOZE, "order": ORDER}


@pytest.fixture
def store(tmp_path):
    return ReaderStore(tmp_path / "data")


@pytest.fixture
def paper():
    return PaperText(PAGES, OUTLINE)


def make(db, maker, paper, kind="any"):
    return _make(db, maker, paper, kind)


def check(raw):
    return validate_quiz(raw, PAGES, OUTLINE)


def answer(store, quiz_id, **body):
    quiz = store.quiz("a1", quiz_id)
    body = {"choice": None, "text": None, **body}
    return asyncio.run(
        answer_quiz(store, None, ITEMS[0], quiz, body.pop("choice"), body.pop("text"), **body)
    )


# ---- validation


def test_the_good_specs_of_every_kind_are_valid_and_grounded():
    for kind, raw in SPECS.items():
        spec = check(raw)
        assert spec["kind"] == kind and spec["page"] == 2
    assert check(MULTI)["correct"] == [0, 2]
    assert check({**MULTI, "correct": [2, 0]})["correct"] == [0, 2]
    assert check({**MULTI, "options": MULTI["options"] + ["Fifth option"]})["options"][4]
    assert check(TF)["correct"] == 1 and check({**TF, "correct": True})["correct"] == 0
    assert check(CLOZE)["answers"] == [CLOZE["answers"][0]]
    assert check({**CLOZE, "answers": ["subspace"]})["answers"] == [["subspace"]]
    assert check(CLOZE2)["answers"] == [["head"], ["subspace"]]


@pytest.mark.parametrize(
    "changes",
    [
        {"options": MULTI["options"][:3]},
        {"options": MULTI["options"] + ["a", "b"]},
        {"options": ["Same", "same!", "Other", "Another"]},
        {"options": ["A", "B", "C", 4]},
        {"correct": []},
        {"correct": [0, 1, 2, 3]},  # all of them
        {"correct": [0, 0]},
        {"correct": [0, 4]},
        {"correct": [-1]},
        {"correct": [True]},
        {"correct": ["0"]},
        {"correct": 0},
        {"correct": None},
        {"question": "Does Heads see different subspaces? Select all that apply."},  # leak
        {"question": "What <b>holds</b>?"},
        {"explanation": "<script>x</script>"},
    ],
)
def test_malformed_multi_is_refused(changes):
    with pytest.raises(QuizError):
        check({**MULTI, **changes})


@pytest.mark.parametrize(
    "changes",
    [{"correct": "true"}, {"correct": 1}, {"correct": None}, {"question": "A <b>claim</b>"},
     {"question": ""}, {"question": "The correct answer is false, right?"}],
)  # fmt: skip
def test_malformed_truefalse_is_refused(changes):
    with pytest.raises(QuizError):
        check({**TF, **changes})


@pytest.mark.parametrize(
    "changes",
    [
        {"question": "No blank at all in this sentence about heads."},
        {"question": "A ___ and a ___ and a ___ in one."},
        {"question": "A blank ____ with four marks."},
        {"question": "A __ short blank."},
        {"answers": []},
        {"answers": [[], []]},
        {"answers": [["a", "b"], ["c"]]},  # two answers lists for one blank
        {"answers": "subspace"},
        {"answers": [[]]},
        {"answers": [["x"] * 5]},
        {"answers": [["same", "Same!"]]},
        {"answers": [[""]]},
        {"answers": [["!!!"]]},
        {"answers": [[3]]},
        {"answers": [["<b>bad</b>"]]},
        {"answers": [["w" * 61]]},
        {"question": "A <b>claim</b> with a ___."},
    ],
)
def test_malformed_cloze_is_refused(changes):
    with pytest.raises(QuizError):
        check({**CLOZE, **changes})


@pytest.mark.parametrize(
    "changes",
    [
        {"steps": ["a b c", "d e f"]},  # too few
        {"steps": [f"step number {i}" for i in range(6)]},  # too many
        {"steps": ["one step", "one step!", "other step"]},  # duplicates
        {"steps": ["one", "two", 3]},
        {"steps": "abc"},
        {"steps": ["one", "two", "<b>three</b>"]},
        {"steps": ["one", "two", "x" * 201]},
        {"steps": None},
    ],
)
def test_malformed_order_is_refused(changes):
    with pytest.raises(QuizError):
        check({**ORDER, **changes})


def test_an_order_quiz_is_shown_shuffled_never_in_the_right_order():
    for _ in range(30):
        spec = check(ORDER)
        assert sorted(spec["shown"]) == [0, 1, 2, 3] and spec["shown"] != [0, 1, 2, 3]
        assert sorted(public_quiz(1, spec)["items"]) == sorted(ORDER["steps"])


def test_blank_marker_stays_in_a_cloze_question_and_is_markup_elsewhere():
    assert "___" in check(CLOZE)["question"]
    with pytest.raises(QuizError):
        check({**GOOD, "question": "What is the ___ of heads?"})


# ---- the public view never has the key


@pytest.mark.parametrize("kind", list(SPECS))
def test_the_public_view_of_each_kind_has_no_key(kind):
    spec = check(SPECS[kind])
    shown = json.dumps(public_quiz(3, spec), separators=(",", ":"))
    for secret in KEYS[kind]:
        assert secret not in shown
    assert set(public_quiz(3, spec)) <= {
        "quiz_id",
        "kind",
        "question",
        "options",
        "blanks",
        "items",
    }


# ---- grading without the model


def test_a_multi_answer_is_all_or_nothing_and_marks_each_option(store, paper):
    _, message = make(store, Maker(MULTI, MULTI, MULTI, MULTI), paper)
    qid = message["content"]["quiz_id"]
    result = answer(store, qid, choices=[2, 0])
    assert result["correct"] and result["choices"] == [0, 2] and result["correct_choices"] == [0, 2]
    for n, ticked in enumerate(([0], [0, 2, 3], [1]), 1):
        _, again = make(store, Maker(MULTI), paper)
        done = answer(store, again["content"]["quiz_id"], choices=ticked)
        assert done["correct"] is False and done["correct_choices"] == [0, 2]
        assert done["score"]["paper"]["total"] == n + 1
    assert len(store.memory_notes("a1")) == 1  # a weak point, once


@pytest.mark.parametrize(
    "body",
    [{}, {"choices": []}, {"choices": [0, 0]}, {"choices": [4]}, {"choices": [-1]},
     {"choices": [0, 1, 2, 3, 3, 3]}, {"choices": [True]}, {"choice": 0}, {"words": ["x"]},
     {"order": [0]}, {"text": "x"}],
)  # fmt: skip
def test_bad_multi_answers_are_refused_and_not_recorded(store, paper, body):
    _, message = make(store, Maker(MULTI), paper)
    with pytest.raises(AnswerError) as bad:
        answer(store, message["content"]["quiz_id"], **body)
    assert bad.value.reason == "bad_answer" and store.quiz_score("a1")["total"] == 0


def test_true_false_is_answered_with_a_choice(store, paper):
    _, message = make(store, Maker(TF, TF), paper)
    assert public_quiz(1, check(TF))["options"] == ["True", "False"]
    right = answer(store, message["content"]["quiz_id"], choice=1)
    assert right["correct"] and right["correct_choice"] == 1
    _, second = make(store, Maker(TF), paper)
    assert answer(store, second["content"]["quiz_id"], choice=0)["correct"] is False
    _, third = make(store, Maker(TF), paper)
    with pytest.raises(AnswerError):
        answer(store, third["content"]["quiz_id"], choice=2)


@pytest.mark.parametrize(
    ("words", "right"),
    [
        (["subspace"], True),
        ([" SubSpace "], True),
        (["sub-space"], True),
        (["sous espace"], True),  # a listed variant, spacing and hyphen folded
        (["Sôus-éspace"], True),  # accents folded
        (["subspaces"], False),
        (["a different subspace"], False),
        (["head"], False),
    ],
)
def test_cloze_is_graded_by_normalised_comparison(store, paper, words, right):
    _, message = make(store, Maker(CLOZE), paper)
    result = answer(store, message["content"]["quiz_id"], words=words)
    assert result["correct"] is right
    assert result["answers"] == ["subspace"] and result["blank_ok"] == [right]
    assert result["words"] == [w.strip() for w in words]


def test_cloze_with_two_blanks_needs_both(store, paper):
    _, message = make(store, Maker(CLOZE2, CLOZE2), paper)
    both = answer(store, message["content"]["quiz_id"], words=["Head", "subspace"])
    assert both["correct"] and both["blank_ok"] == [True, True]
    _, second = make(store, Maker(CLOZE2), paper)
    half = answer(store, second["content"]["quiz_id"], words=["head", "wrong"])
    assert half["correct"] is False and half["blank_ok"] == [True, False]


@pytest.mark.parametrize(
    "body",
    [{}, {"words": []}, {"words": ["a", "b"]}, {"words": [""]}, {"words": ["  "]},
     {"words": ["x" * 101]}, {"words": [3]}, {"words": "subspace"}, {"choice": 0}, {"text": "x"}],
)  # fmt: skip
def test_bad_cloze_answers_are_refused(store, paper, body):
    _, message = make(store, Maker(CLOZE), paper)
    with pytest.raises(AnswerError) as bad:
        answer(store, message["content"]["quiz_id"], **body)
    assert bad.value.reason == "bad_answer" and store.quiz_score("a1")["total"] == 0


def test_order_is_graded_on_the_exact_sequence(store, paper):
    _, message = make(store, Maker(ORDER, ORDER), paper)
    qid = message["content"]["quiz_id"]
    spec = store.quiz("a1", qid)["spec"]
    shown = spec["shown"]
    right_positions = [shown.index(i) for i in range(4)]
    done = answer(store, qid, order=right_positions)
    assert done["correct"] and done["steps"] == ORDER["steps"] and done["order"] == right_positions
    _, second = make(store, Maker(ORDER), paper)
    spec2 = store.quiz("a1", second["content"]["quiz_id"])["spec"]
    wrong = answer(store, second["content"]["quiz_id"], order=list(range(4)))
    assert wrong["correct"] is False and spec2["shown"] != [0, 1, 2, 3]
    assert len(store.memory_notes("a1")) == 1


@pytest.mark.parametrize(
    "body",
    [{}, {"order": []}, {"order": [0, 1, 2]}, {"order": [0, 0, 1, 2]}, {"order": [0, 1, 2, 4]},
     {"order": [0, 1, 2, 3, 4]}, {"order": [True, 1, 2, 3]}, {"order": ["0", 1, 2, 3]},
     {"choices": [0, 1, 2, 3]}],
)  # fmt: skip
def test_bad_order_answers_are_refused(store, paper, body):
    _, message = make(store, Maker(ORDER), paper)
    with pytest.raises(AnswerError):
        answer(store, message["content"]["quiz_id"], **body)
    assert store.quiz_score("a1")["total"] == 0


def test_a_free_quiz_refuses_the_closed_answer_fields(store, paper):
    free = {**BASE, "kind": "free", "question": "Why several heads?", "reference": "Subspaces."}
    _, message = make(store, Maker(free), paper, kind="free")
    for body in ({"choices": [0]}, {"words": ["x"]}, {"order": [0]}):
        with pytest.raises(AnswerError):
            answer(store, message["content"]["quiz_id"], text="a", **body)
    store.save_paper_text("a1", PAGES, OUTLINE)
    quiz = store.quiz("a1", message["content"]["quiz_id"])
    assert asyncio.run(answer_quiz(store, FakeGrader(), ITEMS[0], quiz, None, "x"))["correct"]


def test_scores_persist_for_every_kind(tmp_path, paper):
    data = ReaderStore(tmp_path / "data")
    bodies = {
        "multi": {"choices": [0, 2]},
        "truefalse": {"choice": 1},
        "cloze": {"words": ["subspace"]},
        "order": {"order": [0, 1, 2, 3]},
    }
    for kind, raw in SPECS.items():
        _, message = make(data, Maker(raw), paper, kind=kind)
        qid = message["content"]["quiz_id"]
        body = bodies[kind]
        if kind == "order":
            shown = data.quiz("a1", qid)["spec"]["shown"]
            body = {"order": [shown.index(i) for i in range(4)]}
        assert answer(data, qid, **body)["correct"]
    data.close()
    again = ReaderStore(tmp_path / "data")
    assert again.quiz_score("a1") == {"total": 4, "correct": 4}
    assert {h["kind"] for h in again.quiz_history("a1")} == set(SPECS)
    stored = again.quiz("a1", 4)
    assert stored["answer"]["correct"] and json.loads(stored["answer"]["answer"])


# ---- kinds on request and the maker prompt


def test_a_requested_kind_must_be_the_kind_made(store, paper):
    cid = store.create_conversation("a1", "c")["id"]
    wrong = Maker(MULTI, MULTI)
    with pytest.raises(QuizError, match="not a cloze"):
        asyncio.run(create_quiz(store, wrong, "a1", ITEMS[0], cid, paper, "cloze"))
    ok = Maker(MULTI)
    assert asyncio.run(create_quiz(store, ok, "a1", ITEMS[0], cid, paper, "multi"))
    anything = Maker(ORDER)
    assert asyncio.run(create_quiz(store, anything, "a1", ITEMS[0], cid, paper, "any"))
    assert anything.requests[0].kind == "any"
    with pytest.raises(QuizError, match="unknown"):
        asyncio.run(create_quiz(store, Maker(MULTI), "a1", ITEMS[0], cid, paper, "matching"))


def test_the_maker_prompt_lists_every_kind_and_lets_it_choose_on_any():
    from veille_reader.quiz_agent import MAKER_PROMPT

    for word in ("choice", "multi", "truefalse", "cloze", "order", "free", "___"):
        assert word in MAKER_PROMPT
    anything = maker_prompt(QuizRequest({"title": "T"}, PAGES, "any"))
    assert "suits the content best" in anything and "vary" in anything
    assert "true or false" in maker_prompt(QuizRequest({"title": "T"}, PAGES, "truefalse"))


# ---- routes


@pytest.mark.parametrize("kind", list(SPECS))
def test_no_route_returns_the_key_of_any_kind_before_the_answer(tmp_path, kind):
    client = client_for(tmp_path, Maker(SPECS[kind]))
    cid = cid_of(client)
    created = client.post(f"/api/items/a1/conversations/{cid}/quizzes", json={"kind": kind})
    assert created.status_code == 201
    qid = created.json()["content"]["quiz_id"]
    surfaces = [
        created.text,
        client.get(f"/api/items/a1/conversations/{cid}/messages").text,
        client.get(f"/api/items/a1/quizzes/{qid}").text,
        client.get(f"/api/items/a1/quizzes?conversation={cid}").text,
        client.get(f"/api/items/a1/conversations/{cid}/export").text,
        client.get("/api/items/a1/conversations").text,
        client.get("/api/items/a1/memory").text,
    ]
    for text in surfaces:
        for secret in KEYS[kind]:
            assert secret not in text
        assert "Heads cover" not in text


def test_the_answer_routes_of_the_new_kinds(tmp_path):
    cases = [
        (MULTI, {"choices": [0, 2]}, "correct_choices"),
        (TF, {"choice": 1}, "correct_choice"),
        (CLOZE, {"words": ["Subspace"]}, "blank_ok"),
    ]
    for n, (spec, body, field) in enumerate(cases):
        client = client_for(tmp_path / str(n), Maker(spec))
        cid = cid_of(client)
        made = client.post(f"/api/items/a1/conversations/{cid}/quizzes", json={}).json()
        qid = made["content"]["quiz_id"]
        reply = client.post(f"/api/items/a1/quizzes/{qid}/answer", json=body)
        assert reply.status_code == 200 and reply.json()["correct"] and field in reply.json()
        assert client.post(f"/api/items/a1/quizzes/{qid}/answer", json=body).status_code == 409
        stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[0]["content"]
        assert stored["result"]["correct"] is True


def test_the_order_route_and_bad_bodies(tmp_path):
    client = client_for(tmp_path, Maker(ORDER))
    cid = cid_of(client)
    made = client.post(f"/api/items/a1/conversations/{cid}/quizzes", json={"kind": "order"}).json()
    items, qid = made["content"]["items"], made["content"]["quiz_id"]
    assert sorted(items) == sorted(ORDER["steps"]) and items != ORDER["steps"]
    url = f"/api/items/a1/quizzes/{qid}/answer"
    bodies = [{"order": [0, 1]}, {"order": "abc"}, {"order": [0] * 6}, {"words": ["a", "b", "c"]}]
    bodies += [{"choices": [0] * 6}, {"words": ["x" * 101]}]
    for body in bodies:
        assert client.post(url, json=body).status_code == 422
    right = [items.index(step) for step in ORDER["steps"]]
    reply = client.post(url, json={"order": right}).json()
    assert reply["correct"] and reply["steps"] == ORDER["steps"]


def test_the_quiz_route_accepts_only_known_kinds(tmp_path):
    client = client_for(tmp_path, Maker(GOOD))
    cid = cid_of(client)
    bad = client.post(f"/api/items/a1/conversations/{cid}/quizzes", json={"kind": "matching"})
    assert bad.status_code == 422
    assert (
        client.post(f"/api/items/a1/conversations/{cid}/quizzes", json={"kind": "any"}).status_code
        == 201
    )


def test_a_quote_copied_across_a_line_break_is_accepted_but_other_control_characters_are_not():
    assert check({**MULTI, "quote": "each head attend\nto a different   subspace"})["quote"] == (
        "each head attend to a different subspace"
    )
    with pytest.raises(QuizError):
        check({**MULTI, "quote": "each head attend\x00to a different subspace"})
