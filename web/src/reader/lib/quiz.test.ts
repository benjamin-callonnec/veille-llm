import { expect, test } from "vitest";
import { scoreLine, stripQuizMarker, toQuiz, toResult } from "./quiz";

const score = { paper: { total: 5, correct: 3 }, session: { total: 2, correct: 1 } };
const result = {
  correct: false,
  explanation: "Because.",
  quote: "a quote",
  page: 2,
  section: "Method",
  score,
  choice: 1,
  correct_choice: 0,
};

test("a quiz message keeps only text fields and needs its options", () => {
  const ok = toQuiz({ quiz_id: 3, kind: "choice", question: "Q?", options: ["a", "b", 3, "c"] });
  expect(ok?.options).toEqual(["a", "b", "c"]);
  expect(toQuiz({ quiz_id: 3, kind: "choice", question: "Q?", options: ["a"] })).toBeNull();
  expect(toQuiz({ quiz_id: 3, kind: "free", question: "Q?" })?.options).toEqual([]);
  for (const bad of [null, "x", {}, { quiz_id: "3", kind: "free", question: "Q" }])
    expect(toQuiz(bad)).toBeNull();
  expect(toQuiz({ quiz_id: 1, kind: "essay", question: "Q" })).toBeNull();
});

test("a result is read when it is complete and dropped otherwise", () => {
  expect(toResult(result)?.correct_choice).toBe(0);
  expect(toResult({ ...result, score: {} })).toBeUndefined();
  expect(toResult({ ...result, page: "2" })).toBeUndefined();
  expect(toResult("no")).toBeUndefined();
  expect(toResult({ ...result, section: 4 })?.section).toBeNull();
});

test("the quiz marker is hidden, also while it is being written", () => {
  expect(stripQuizMarker("Sure.\n[[quiz: heads]]")).toBe("Sure.");
  expect(stripQuizMarker("Sure. [[quiz:]]")).toBe("Sure.");
  expect(stripQuizMarker("Sure.\n[[quiz: he")).toBe("Sure.");
  expect(stripQuizMarker("Sure.\n[[q")).toBe("Sure.");
  expect(stripQuizMarker("See [p.3] and x[1]")).toBe("See [p.3] and x[1]");
});

test("the score line names the paper and, when different, the session", () => {
  expect(scoreLine(score)).toBe("3/5 on this paper · 1/2 this session");
  expect(scoreLine({ paper: { total: 2, correct: 1 }, session: { total: 2, correct: 1 } })).toBe(
    "1/2 on this paper",
  );
  expect(scoreLine({ paper: { total: 1, correct: 1 }, session: null })).toBe("1/1 on this paper");
});

test("the new kinds keep only what they need and are refused when malformed", () => {
  const base = { quiz_id: 1, question: "Q?" };
  expect(toQuiz({ ...base, kind: "multi", options: ["a", "b", "c", "d"] })?.options).toHaveLength(
    4,
  );
  expect(toQuiz({ ...base, kind: "multi", options: ["a", "b"] })).toBeNull();
  expect(toQuiz({ ...base, kind: "truefalse", options: ["True", "False"] })?.options).toHaveLength(
    2,
  );
  expect(toQuiz({ ...base, kind: "truefalse", options: ["x"] })).toBeNull();
  expect(toQuiz({ ...base, kind: "cloze", blanks: 2 })?.blanks).toBe(2);
  expect(toQuiz({ ...base, kind: "cloze", blanks: 0 })).toBeNull();
  expect(toQuiz({ ...base, kind: "order", items: ["a", "b", "c", 4] })?.items).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(toQuiz({ ...base, kind: "order", items: ["a"] })).toBeNull();
  // a free quiz drops what it should not carry
  expect(
    toQuiz({ ...base, kind: "free", options: ["a", "b"], items: ["x"], blanks: 2 }),
  ).toMatchObject({ options: [], items: [], blanks: 0 });
});

test("results of the new kinds are read field by field", () => {
  const read = toResult({
    ...result,
    choices: [0, 2],
    correct_choices: [0, 1],
    words: ["a"],
    answers: ["b"],
    blank_ok: [false],
    order: [1, 0],
    steps: ["x", "y"],
  });
  expect(read).toMatchObject({
    choices: [0, 2],
    correct_choices: [0, 1],
    words: ["a"],
    answers: ["b"],
    blank_ok: [false],
    order: [1, 0],
    steps: ["x", "y"],
  });
  const bad = toResult({ ...result, choices: ["x"], words: [1], blank_ok: [1], order: "no" });
  expect(bad?.choices).toBeUndefined();
  expect(bad?.words).toBeUndefined();
  expect(bad?.blank_ok).toBeUndefined();
  expect(bad?.order).toBeUndefined();
});
