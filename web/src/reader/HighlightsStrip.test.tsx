import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { HighlightsStrip } from "./HighlightsStrip";
import { QuestionList } from "./QuestionList";

afterEach(cleanup);

const hl = (id: number, page: number, color: string, text: string) => ({
  id,
  page,
  color,
  text,
  rects: [],
  created_at: "x",
});
const list = [hl(1, 1, "yellow", "first"), hl(2, 3, "green", "<i>second</i>")];

test("lists highlights, filters by colour, jumps and deletes", async () => {
  const onGo = vi.fn();
  const onRemove = vi.fn();
  render(<HighlightsStrip highlights={list} onGo={onGo} onRemove={onRemove} />);
  await userEvent.click(screen.getByRole("button", { name: "Highlights (2)" }));
  expect(screen.getByText(/<i>second<\/i>/)).toBeTruthy();
  expect(document.querySelector("i")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Show green" }));
  expect(screen.queryByText("first")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /p\.3/ }));
  expect(onGo).toHaveBeenCalledWith(3);
  await userEvent.click(screen.getByRole("button", { name: "Delete highlight" }));
  expect(onRemove).toHaveBeenCalledWith(2);
});

test("is closed by default and handles an empty list", async () => {
  render(<HighlightsStrip highlights={[]} onGo={() => {}} onRemove={() => {}} />);
  expect(screen.getByRole("button", { name: "Highlights (0)" })).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});

test("question list shows quote, page and question as text, and jumps", async () => {
  const onGo = vi.fn();
  const q = { quote: { text: "<b>quoted</b>", page: 4, rects: [] }, question: "Why <u>this</u>?" };
  render(<QuestionList questions={[q]} onGo={onGo} />);
  expect(screen.getByText("<b>quoted</b>")).toBeTruthy();
  expect(screen.getByText("Why <u>this</u>?")).toBeTruthy();
  expect(document.querySelector("b,u")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Go to page 4" }));
  expect(onGo).toHaveBeenCalledWith(4);
});

test("question list hints at what to do when empty", () => {
  render(<QuestionList questions={[]} onGo={() => {}} />);
  expect(screen.getByText(/select a passage/i)).toBeTruthy();
});
