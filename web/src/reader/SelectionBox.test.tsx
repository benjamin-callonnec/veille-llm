import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SelectionBox } from "./SelectionBox";

afterEach(cleanup);

const quote = {
  text: "a passage",
  page: 2,
  rects: [[0, 0, 1, 1]] as [number, number, number, number][],
};

const setup = () => {
  const handlers = { onAsk: vi.fn(), onHighlight: vi.fn(), onCopy: vi.fn(), onClose: vi.fn() };
  render(<SelectionBox quote={quote} anchor={{ x: 100, y: 200 }} {...handlers} />);
  return handlers;
};

test("Enter sends the question once", async () => {
  const h = setup();
  await userEvent.type(screen.getByPlaceholderText("Ask about this passage…"), "Why?{Enter}");
  expect(h.onAsk).toHaveBeenCalledTimes(1);
  expect(h.onAsk).toHaveBeenCalledWith("Why?");
});

test("an empty or blank question is not sent", async () => {
  const h = setup();
  await userEvent.type(screen.getByPlaceholderText("Ask about this passage…"), "   {Enter}");
  expect(h.onAsk).not.toHaveBeenCalled();
});

test.each(["yellow", "green", "red"])("the %s dot highlights without asking", async (color) => {
  const h = setup();
  await userEvent.click(screen.getByRole("button", { name: `Highlight ${color}` }));
  expect(h.onHighlight).toHaveBeenCalledWith(color);
  expect(h.onAsk).not.toHaveBeenCalled();
});

test("Copy and Escape", async () => {
  const h = setup();
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(h.onCopy).toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  expect(h.onClose).toHaveBeenCalled();
});

test("copy is an icon with a name and a tooltip, not a text button", () => {
  setup();
  const copy = screen.getByRole("button", { name: "Copy" });
  expect(copy.textContent).toBe("");
  expect(copy.getAttribute("title")).toBe("Copy");
  expect(copy.querySelector("svg")).not.toBeNull();
  expect(copy.className).toContain("icon-btn");
});
