import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { HighlightsStrip } from "./HighlightsStrip";

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
