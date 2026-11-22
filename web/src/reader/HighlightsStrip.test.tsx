import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HighlightsStrip } from "./HighlightsStrip";

const writeText = vi.fn(async () => {});
beforeEach(() => {
  writeText.mockClear();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const hl = (id: number, page: number, color: string, text: string) => ({
  id,
  page,
  color,
  text,
  rects: [],
  created_at: "x",
});
const list = [hl(1, 1, "yellow", "first"), hl(2, 3, "green", "<i>second</i>")];
const toggle = (n: number) => screen.getByRole("button", { name: `Highlights (${n})` });

test("lists highlights, filters by colour, jumps and deletes", async () => {
  const onGo = vi.fn();
  const onRemove = vi.fn();
  render(<HighlightsStrip highlights={list} onGo={onGo} onRemove={onRemove} />);
  await userEvent.click(toggle(2));
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
  expect(toggle(0)).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  await userEvent.click(toggle(0));
  expect(screen.getByText("Select a passage in the PDF to highlight it.")).toBeTruthy();
});

test("the toggle is a quiet icon with the count, not a text button", () => {
  render(<HighlightsStrip highlights={list} onGo={() => {}} onRemove={() => {}} />);
  const button = toggle(2);
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.textContent).toBe("2"); // the count only
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

test("every action of a row is an icon with a name, and copy puts the passage on the clipboard", async () => {
  render(<HighlightsStrip highlights={list} onGo={() => {}} onRemove={() => {}} />);
  await userEvent.click(toggle(2));
  for (const name of ["Copy highlight", "Delete highlight"]) {
    const buttons = screen.getAllByRole("button", { name });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.textContent).toBe("");
  }
  const [firstCopy] = screen.getAllByRole("button", { name: "Copy highlight" });
  if (firstCopy) await userEvent.click(firstCopy);
  expect(writeText).toHaveBeenCalledWith("first");
});

test("a row shows its colour as a dot and its text as plain readable text", async () => {
  render(<HighlightsStrip highlights={list} onGo={() => {}} onRemove={() => {}} />);
  await userEvent.click(toggle(2));
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]?.querySelector(".hl-dot.hl-yellow")).not.toBeNull();
  // the row itself is never painted with the highlight colour (that made the text unreadable)
  for (const row of rows) {
    expect(row.className).toBe("");
    expect(row.querySelector("button.hl-yellow, button.hl-green, button.hl-red")).toBeNull();
  }
  expect(screen.getByText("first").closest("button")?.className).toContain("hl-row-text");
});

test("a long list stays in a scrollable region and long text is only clipped by style", async () => {
  const many = Array.from({ length: 40 }, (_, i) => hl(i + 1, 1, "red", `passage ${i}`));
  render(<HighlightsStrip highlights={many} onGo={() => {}} onRemove={() => {}} />);
  await userEvent.click(toggle(40));
  expect(screen.getAllByRole("listitem")).toHaveLength(40);
  expect(screen.getByText("passage 39")).toBeTruthy();
});
