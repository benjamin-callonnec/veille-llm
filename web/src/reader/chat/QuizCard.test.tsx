import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { QuizResult } from "../lib/quiz";
import { StoredAssistantMessage } from "./AssistantMessage";
import { QuizCard } from "./QuizCard";
import { httpQuizApi, type QuizApi, QuizApiError } from "./quizApi";

afterEach(cleanup);

const choice = {
  quiz_id: 7,
  kind: "choice",
  question: "What does a head do?",
  options: ["Attend to a subspace", "Store weights", "Clip gradients", "Tokenise"],
};
const result: QuizResult = {
  correct: false,
  explanation: "Each head looks at its own subspace.",
  quote: "each head attend",
  page: 2,
  section: "Method",
  choice: 1,
  correct_choice: 0,
  score: { paper: { total: 5, correct: 3 }, session: null },
};

function apiReturning(r: QuizResult | Error, known: unknown = null) {
  const answer = vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  });
  const get = vi.fn(async () => known);
  return { api: { start: vi.fn(), answer, get } as unknown as QuizApi, answer, get };
}

test("before the reply only the question and options show, with no explanation", () => {
  render(<QuizCard itemId="a1" content={choice} api={apiReturning(result).api} />);
  expect(screen.getByText("What does a head do?")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(4);
  expect(screen.queryByText(/own subspace/)).toBeNull();
  expect(screen.queryByText(/on this paper/)).toBeNull();
  // a single choice has nothing to validate: a click answers
  expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
});

test("clicking an option answers at once and shows the verdict, the right option, the citation and the score", async () => {
  const { api, answer } = apiReturning(result);
  const onCite = vi.fn();
  render(<QuizCard itemId="a1" content={choice} api={api} onCite={onCite} />);
  await userEvent.click(screen.getByRole("button", { name: /Store weights/ }));
  expect(answer).toHaveBeenCalledWith("a1", 7, { choice: 1 });
  expect(await screen.findByText("Not quite")).toBeTruthy();
  expect(screen.getByText("Each head looks at its own subspace.")).toBeTruthy();
  expect(screen.getByText("Correct answer")).toBeTruthy();
  expect(screen.getByText("3/5 on this paper")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "p.2" }));
  expect(onCite).toHaveBeenCalledWith(2, "each head attend");
  expect(
    (screen.getByRole("button", { name: /Attend to a subspace/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

test("an answered quiz loaded from history shows its result at once", () => {
  render(
    <QuizCard
      itemId="a1"
      content={{ ...choice, result: { ...result, correct: true, choice: 0 } }}
      api={apiReturning(result).api}
    />,
  );
  expect(screen.getByText("Correct")).toBeTruthy();
  expect(screen.getByText("3/5 on this paper")).toBeTruthy();
});

test("a free answer is typed, sent, and shown with the grader's reasoning", async () => {
  const free = { quiz_id: 8, kind: "free", question: "Why several heads?" };
  const graded: QuizResult = {
    ...result,
    correct: true,
    choice: undefined,
    correct_choice: undefined,
    answer: "Different subspaces",
    reference: "Each head attends to a different subspace.",
    reasoning: "Matches the paper on p.2.",
  };
  const { api, answer } = apiReturning(graded);
  render(<QuizCard itemId="a1" content={free} api={api} />);
  await userEvent.type(screen.getByLabelText("Your answer"), "  Different subspaces ");
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
  expect(answer).toHaveBeenCalledWith("a1", 8, { text: "Different subspaces" });
  expect(await screen.findByText("Matches the paper on p.2.")).toBeTruthy();
  expect(screen.getByText(/Model answer: Each head/)).toBeTruthy();
  expect(screen.getByText("Different subspaces")).toBeTruthy();
});

test("a failed check keeps the card open and says so", async () => {
  render(<QuizCard itemId="a1" content={choice} api={apiReturning(new Error("x")).api} />);
  await userEvent.click(screen.getByRole("button", { name: /Tokenise/ }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not check your answer. Try again.",
  );
  expect(screen.queryByText("Not quite")).toBeNull();
  expect((screen.getByRole("button", { name: /Tokenise/ }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

test("a double click answers once and the option is busy meanwhile", async () => {
  let release: (r: QuizResult) => void = () => {};
  const answer = vi.fn(() => new Promise<QuizResult>((resolve) => (release = resolve)));
  const api = { start: vi.fn(), answer, get: vi.fn() } as unknown as QuizApi;
  render(<QuizCard itemId="a1" content={choice} api={api} />);
  const option = screen.getByRole("button", { name: /Clip gradients/ });
  await userEvent.dblClick(option);
  expect(answer).toHaveBeenCalledTimes(1);
  expect(option.getAttribute("aria-busy")).toBe("true");
  release(result);
  expect(await screen.findByText("Not quite")).toBeTruthy();
});

test.each([
  [422, "That answer was not accepted. Check it and try again."],
  [502, "The grader could not check this answer. Try again."],
  [503, "Grading is not available right now."],
  [500, "Could not check your answer. Try again."],
])("a %i from the server says why", async (status, message) => {
  const { api } = apiReturning(new QuizApiError(status, "x"));
  render(<QuizCard itemId="a1" content={choice} api={api} />);
  await userEvent.click(screen.getByRole("button", { name: /Tokenise/ }));
  expect((await screen.findByRole("alert")).textContent).toBe(message);
});

test("an answer given in another tab (409) shows the result the server has", async () => {
  const known = { ...choice, result: { ...result, correct: true, choice: 0 } };
  const { api, get } = apiReturning(new QuizApiError(409, "already_answered"), known);
  render(<QuizCard itemId="a1" content={choice} api={api} />);
  await userEvent.click(screen.getByRole("button", { name: /Tokenise/ }));
  expect(await screen.findByText("Correct")).toBeTruthy();
  expect(get).toHaveBeenCalledWith("a1", 7);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a 409 whose quiz cannot be read says it could not be checked", async () => {
  const { api } = apiReturning(new QuizApiError(409, "already_answered"), null);
  render(<QuizCard itemId="a1" content={choice} api={api} />);
  await userEvent.click(screen.getByRole("button", { name: /Tokenise/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not check");
});

test("a card with no paper id refuses to call the server", async () => {
  const { api, answer } = apiReturning(result);
  render(<QuizCard itemId="" content={choice} api={api} />);
  await userEvent.click(screen.getByRole("button", { name: /Tokenise/ }));
  expect(answer).not.toHaveBeenCalled();
  expect((await screen.findByRole("alert")).textContent).toContain("not attached to a paper");
});

test("the http api never calls the server with an empty paper id", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  try {
    await expect(httpQuizApi.answer("", 1, { choice: 0 })).rejects.toThrow("id of its paper");
    await expect(httpQuizApi.get("", 1)).rejects.toThrow();
    await expect(httpQuizApi.start("", 1)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("the http api reads the server's reason and defaults the kind to any", async () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ reason: "bad_answer" }), { status: 422 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    const failed = await httpQuizApi.answer("a1", 2, { choice: 9 }).catch((e) => e);
    expect(failed).toBeInstanceOf(QuizApiError);
    expect(failed).toMatchObject({ status: 422, reason: "bad_answer" });
    await httpQuizApi.start("a1", 3).catch(() => {});
    const call = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/items/a1/conversations/3/quizzes");
    expect(JSON.parse(String(call[1].body))).toEqual({ focus: "", kind: "any" });
  } finally {
    vi.unstubAllGlobals();
  }
});

// ---- the other formats

const multi = {
  quiz_id: 9,
  kind: "multi",
  question: "Which hold?",
  options: ["One", "Two", "Three", "Four"],
};
const multiResult: QuizResult = {
  ...result,
  correct: false,
  choice: undefined,
  correct_choice: undefined,
  choices: [0, 3],
  correct_choices: [0, 2],
};

test("multiple choice: options toggle and the arrow appears once one is ticked", async () => {
  const { api, answer } = apiReturning(multiResult);
  render(<QuizCard itemId="a1" content={multi} api={api} />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Four" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "One" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Four" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Four" }));
  expect(answer).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
  expect(answer).toHaveBeenCalledWith("a1", 9, { choices: [0, 3] });
  expect(await screen.findByText("Not quite")).toBeTruthy();
  expect(screen.getByText("Right, and you ticked it")).toBeTruthy();
  expect(screen.getByText("Not right, you ticked it")).toBeTruthy();
  expect(screen.getByText("Right, you missed it")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
});

test("unticking the last option hides the arrow again", async () => {
  render(<QuizCard itemId="a1" content={multi} api={apiReturning(multiResult).api} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Two" }));
  expect(screen.getByRole("button", { name: "Check answer" })).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox", { name: "Two" }));
  expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
});

const tf = {
  quiz_id: 10,
  kind: "truefalse",
  question: "Heads share weights.",
  options: ["True", "False"],
};

test("true or false: a click answers, with no validate button", async () => {
  const { api, answer } = apiReturning({ ...result, choice: 1, correct_choice: 1, correct: true });
  render(<QuizCard itemId="a1" content={tf} api={api} />);
  expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "False" }));
  expect(answer).toHaveBeenCalledWith("a1", 10, { choice: 1 });
  expect(await screen.findByText("Correct")).toBeTruthy();
});

const cloze = {
  quiz_id: 11,
  kind: "cloze",
  question: "Each ___ attends to a ___ of the input.",
  blanks: 2,
};

test("cloze: the blanks are typed in the sentence and sent with the arrow", async () => {
  const graded: QuizResult = {
    ...result,
    correct: false,
    choice: undefined,
    correct_choice: undefined,
    words: ["head", "part"],
    answers: ["head", "subspace"],
    blank_ok: [true, false],
  };
  const { api, answer } = apiReturning(graded);
  render(<QuizCard itemId="a1" content={cloze} api={api} />);
  const arrow = screen.getByRole("button", { name: "Check answer" }) as HTMLButtonElement;
  expect(arrow.disabled).toBe(true);
  await userEvent.type(screen.getByLabelText("Blank 1"), " head ");
  expect(arrow.disabled).toBe(true);
  await userEvent.type(screen.getByLabelText("Blank 2"), "part");
  await userEvent.click(arrow);
  expect(answer).toHaveBeenCalledWith("a1", 11, { words: ["head", "part"] });
  expect(await screen.findByText("Expected: head, subspace")).toBeTruthy();
  expect(screen.queryByLabelText("Blank 1")).toBeNull();
  expect(screen.getByText("part")).toBeTruthy();
});

test("cloze: Enter in the last blank sends too", async () => {
  const { api, answer } = apiReturning(result);
  render(
    <QuizCard itemId="a1" content={{ ...cloze, blanks: 1, question: "A ___ ok." }} api={api} />,
  );
  await userEvent.type(screen.getByLabelText("Blank 1"), "x{Enter}");
  expect(answer).toHaveBeenCalledWith("a1", 11, { words: ["x"] });
});

const order = {
  quiz_id: 12,
  kind: "order",
  question: "Order these.",
  items: ["Gamma", "Alpha", "Beta"],
};

function stepNames() {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

test("order: the up and down icons move steps and the arrow sends the order", async () => {
  const graded: QuizResult = {
    ...result,
    correct: true,
    choice: undefined,
    correct_choice: undefined,
    order: [1, 2, 0],
    steps: ["Alpha", "Beta", "Gamma"],
  };
  const { api, answer } = apiReturning(graded);
  render(<QuizCard itemId="a1" content={order} api={api} />);
  expect(
    (screen.getByRole("button", { name: "Move up: Gamma" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Move down: Beta" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Move down: Gamma" }));
  await userEvent.click(screen.getByRole("button", { name: "Move down: Gamma" }));
  expect(stepNames().map((t) => t.replace(/[0-9]|Move.*/g, ""))).toEqual([
    "Alpha",
    "Beta",
    "Gamma",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
  expect(answer).toHaveBeenCalledWith("a1", 12, { order: [1, 2, 0] });
  expect(await screen.findByText("Correct")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
});

test("order: a wrong answer shows the right order", async () => {
  const graded: QuizResult = {
    ...result,
    correct: false,
    choice: undefined,
    correct_choice: undefined,
    order: [0, 1, 2],
    steps: ["Alpha", "Beta", "Gamma"],
  };
  render(<QuizCard itemId="a1" content={order} api={apiReturning(graded).api} />);
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
  expect(await screen.findByText("Right order:")).toBeTruthy();
  expect(screen.getAllByText("Alpha")).toHaveLength(2);
});

test("a malformed multi, true or false, cloze or order card renders nothing", () => {
  const bad = [
    { ...multi, options: ["a", "b"] },
    { ...tf, options: ["True"] },
    { ...cloze, blanks: 0 },
    { ...cloze, blanks: 3 },
    { ...order, items: ["a", "b"] },
  ];
  for (const content of bad) {
    const { container } = render(<QuizCard itemId="a1" content={content} />);
    expect(container.innerHTML).toBe("");
    cleanup();
  }
});

test("a malformed quiz renders nothing and markup in the question stays text", () => {
  const { container, rerender } = render(<QuizCard itemId="a1" content={{ nope: 1 }} />);
  expect(container.innerHTML).toBe("");
  rerender(
    <QuizCard itemId="a1" content={{ ...choice, question: "<img src=x onerror=alert(1)>" }} />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
});

test("the tutor's quiz marker is never shown in its answer", () => {
  render(<StoredAssistantMessage content={{ answer: "Here you go.\n[[quiz: heads]]" }} />);
  expect(screen.getByText("Here you go.")).toBeTruthy();
  expect(screen.queryByText(/quiz:/)).toBeNull();
});
