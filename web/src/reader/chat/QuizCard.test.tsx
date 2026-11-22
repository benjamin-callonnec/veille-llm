import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { QuizResult } from "../lib/quiz";
import { StoredAssistantMessage } from "./AssistantMessage";
import { QuizCard } from "./QuizCard";
import type { QuizApi } from "./quizApi";

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

function apiReturning(r: QuizResult | Error) {
  const answer = vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  });
  return { api: { start: vi.fn(), answer } as unknown as QuizApi, answer };
}

test("before the reply only the question and options show, with no explanation", () => {
  render(<QuizCard itemId="a1" content={choice} api={apiReturning(result).api} />);
  expect(screen.getByText("What does a head do?")).toBeTruthy();
  expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(4);
  expect(screen.queryByText(/own subspace/)).toBeNull();
  expect(screen.queryByText(/on this paper/)).toBeNull();
  expect((screen.getByRole("button", { name: "Check answer" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("picking an option and checking it shows the verdict, the right option, the citation and the score", async () => {
  const { api, answer } = apiReturning(result);
  const onCite = vi.fn();
  render(<QuizCard itemId="a1" content={choice} api={api} onCite={onCite} />);
  await userEvent.click(screen.getByRole("button", { name: /Store weights/ }));
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
  expect(answer).toHaveBeenCalledWith("a1", 7, { choice: 1 });
  expect(await screen.findByText("Not quite")).toBeTruthy();
  expect(screen.getByText("Each head looks at its own subspace.")).toBeTruthy();
  expect(screen.getByText("Correct answer")).toBeTruthy();
  expect(screen.getByText("3/5 on this paper")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "p.2" }));
  expect(onCite).toHaveBeenCalledWith(2, "each head attend");
  expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
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
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.queryByText("Not quite")).toBeNull();
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
