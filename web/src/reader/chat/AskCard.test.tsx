import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AskCard, toAsk } from "./AskCard";

afterEach(cleanup);

const pending = {
  id: "a",
  question: "Which part?",
  options: ["Intro", "Method"],
  status: "pending" as const,
};

test("an option sends its text as the answer", async () => {
  const onAnswer = vi.fn(async () => {});
  render(<AskCard card={pending} onAnswer={onAnswer} />);
  await userEvent.click(screen.getByRole("button", { name: "Method" }));
  expect(onAnswer).toHaveBeenCalledWith("Method");
});

test("a typed answer is sent with Enter or the icon, and blank is not sent", async () => {
  const onAnswer = vi.fn(async () => {});
  render(<AskCard card={{ ...pending, options: [] }} onAnswer={onAnswer} />);
  const send = screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  await userEvent.type(screen.getByLabelText("Your answer"), "  the proof  {Enter}");
  expect(onAnswer).toHaveBeenCalledWith("the proof");
});

test("a failed send says so and lets you retry", async () => {
  const onAnswer = vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValue(undefined);
  render(<AskCard card={pending} onAnswer={onAnswer} />);
  await userEvent.click(screen.getByRole("button", { name: "Intro" }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not be sent");
  await userEvent.click(screen.getByRole("button", { name: "Intro" }));
  expect(onAnswer).toHaveBeenCalledTimes(2);
});

test("an answered card shows the answer and no controls", () => {
  render(<AskCard card={{ ...pending, status: "answered", answer: "Intro" }} />);
  expect(screen.getByText("Intro")).toBeTruthy();
  expect(screen.queryByLabelText("Your answer")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

test("an expired card, or a pending one nobody waits for, says the tutor carried on", () => {
  const { rerender } = render(<AskCard card={{ ...pending, status: "expired" }} />);
  expect(screen.getByText(/carried on/)).toBeTruthy();
  rerender(<AskCard card={pending} />);
  expect(screen.getByText(/carried on/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("a stored card is read defensively", () => {
  expect(toAsk(null)).toBeNull();
  expect(toAsk({ id: 3, question: "?" })).toBeNull();
  expect(toAsk({ id: "a", question: "Q", options: ["x", 4], status: "weird" })).toEqual({
    id: "a",
    question: "Q",
    options: ["x"],
    status: "pending",
  });
});
