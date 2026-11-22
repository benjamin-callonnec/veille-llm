import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { SHORTCUTS, ShortcutsMenu } from "./ShortcutsMenu";

afterEach(cleanup);

const gear = () => screen.getByRole("button", { name: "Keyboard shortcuts" });

test("a small gear button is there, closed by default", () => {
  render(<ShortcutsMenu />);
  expect(gear().getAttribute("aria-expanded")).toBe("false");
  expect(gear().getAttribute("title")).toMatch(/Keyboard shortcuts/);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("clicking it lists the shortcuts by group", async () => {
  render(<ShortcutsMenu />);
  await userEvent.click(gear());
  const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
  expect(gear().getAttribute("aria-expanded")).toBe("true");
  for (const group of SHORTCUTS) {
    expect(dialog.textContent).toContain(group.title);
    for (const entry of group.entries) expect(dialog.textContent).toContain(entry.label);
  }
});

test("the real shortcuts of the reader are listed", async () => {
  render(<ShortcutsMenu />);
  await userEvent.click(gear());
  const text = screen.getByRole("dialog").textContent ?? "";
  for (const expected of [
    "Alt",
    "Toggle the PDF pane",
    "Toggle the chat pane",
    "PageDown",
    "Zoom in",
    "Search in the paper",
    "Send the message",
    "New line",
    "Close",
  ]) {
    expect(text).toContain(expected);
  }
});

test("keys are shown as keyboard keys", async () => {
  render(<ShortcutsMenu />);
  await userEvent.click(gear());
  const keys = Array.from(document.querySelectorAll("kbd")).map((k) => k.textContent);
  expect(keys).toContain("PageDown");
  expect(keys).toContain("1");
  expect(keys).toContain("2");
});

test("Escape closes it", async () => {
  render(<ShortcutsMenu />);
  await userEvent.click(gear());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("clicking outside closes it, clicking the gear again too", async () => {
  render(
    <>
      <p>outside</p>
      <ShortcutsMenu />
    </>,
  );
  await userEvent.click(gear());
  await userEvent.click(screen.getByText("outside"));
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(gear());
  await userEvent.click(gear());
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the question mark key toggles it, except while typing", async () => {
  render(
    <>
      <textarea aria-label="Typing" />
      <ShortcutsMenu />
    </>,
  );
  await userEvent.keyboard("?");
  expect(screen.getByRole("dialog")).toBeTruthy();
  await userEvent.keyboard("?");
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(screen.getByRole("textbox", { name: "Typing" }));
  await userEvent.keyboard("?");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the listed pane shortcuts are the ones PaneLayout really uses", () => {
  const panes = SHORTCUTS.find((g) => g.title === "Panes");
  const labels = panes?.entries.map((e) => `${e.keys.join("+")}:${e.label}`) ?? [];
  expect(labels).toContain("Alt+1:Toggle the PDF pane");
  expect(labels).toContain("Alt+2:Toggle the chat pane");
});
