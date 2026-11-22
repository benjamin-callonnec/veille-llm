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

test("the send icon only appears once there is text, and it sends", async () => {
  const h = setup();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  await userEvent.type(screen.getByPlaceholderText("Ask about this passage…"), "Why?");
  const send = screen.getByRole("button", { name: "Send" });
  expect(send.textContent).toBe("");
  await userEvent.click(send);
  expect(h.onAsk).toHaveBeenCalledWith("Why?");
});

test("a blank question shows no send icon", async () => {
  setup();
  await userEvent.type(screen.getByPlaceholderText("Ask about this passage…"), "   ");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

test("the colour dots are real buttons with a name and no text", () => {
  setup();
  for (const color of ["yellow", "green", "red"]) {
    const dot = screen.getByRole("button", { name: `Highlight ${color}` });
    expect(dot.textContent).toBe("");
    expect(dot.getAttribute("title")).toBe(`Highlight ${color}`);
  }
});
