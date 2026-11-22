import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CATALOGUE_SHORTCUTS, READER_SHORTCUTS } from "../lib/shortcuts";
import { SettingsMenu } from "./SettingsMenu";

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memory.set(k, v);
  },
} as unknown as Storage;

beforeEach(() => {
  memory.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

const gear = () => screen.getByRole("button", { name: "Settings" });
const open = async (groups = READER_SHORTCUTS) => {
  render(<SettingsMenu shortcuts={groups} storage={storage} />);
  await userEvent.click(gear());
  return screen.getByRole("dialog", { name: "Settings" });
};

test("a small gear is there, closed by default", () => {
  render(<SettingsMenu shortcuts={READER_SHORTCUTS} storage={storage} />);
  expect(gear().getAttribute("aria-expanded")).toBe("false");
  expect(gear().getAttribute("title")).toMatch(/Settings/);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the panel has a theme choice and the shortcuts of the page", async () => {
  const dialog = await open();
  expect(dialog.textContent).toContain("Theme");
  expect(screen.getByRole("radio", { name: /Auto/ })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /Papier/ })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /Nuit/ })).toBeTruthy();
  for (const group of READER_SHORTCUTS) {
    expect(dialog.textContent).toContain(group.title);
    for (const entry of group.entries) expect(dialog.textContent).toContain(entry.label);
  }
});

test("on the catalogue it lists the catalogue shortcuts, not the reader ones", async () => {
  const dialog = await open(CATALOGUE_SHORTCUTS);
  expect(dialog.textContent).toContain("Search the catalogue");
  expect(dialog.textContent).not.toContain("Toggle the PDF pane");
});

test("keys are shown as keyboard keys", async () => {
  await open();
  const keys = Array.from(document.querySelectorAll("kbd")).map((k) => k.textContent);
  expect(keys).toContain("PageDown");
  expect(keys).toContain("Alt");
});

test("choosing Nuit sets the dark theme and remembers it", async () => {
  await open();
  await userEvent.click(screen.getByRole("radio", { name: /Nuit/ }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(memory.get("veille-theme")).toBe("dark");
});

test("choosing Papier sets the light theme, Auto goes back to the system", async () => {
  await open();
  await userEvent.click(screen.getByRole("radio", { name: /Papier/ }));
  expect(document.documentElement.dataset.theme).toBe("light");
  await userEvent.click(screen.getByRole("radio", { name: /Auto/ }));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(memory.get("veille-theme")).toBe("auto");
});

test("the stored theme is the one selected when the panel opens", async () => {
  memory.set("veille-theme", "dark");
  await open();
  expect((screen.getByRole("radio", { name: /Nuit/ }) as HTMLInputElement).checked).toBe(true);
});

test("it works when storage is unavailable", async () => {
  render(<SettingsMenu shortcuts={READER_SHORTCUTS} storage={null} />);
  await userEvent.click(gear());
  await userEvent.click(screen.getByRole("radio", { name: /Nuit/ }));
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("Escape, a click outside and the gear itself close it", async () => {
  render(
    <>
      <p>outside</p>
      <SettingsMenu shortcuts={READER_SHORTCUTS} storage={storage} />
    </>,
  );
  await userEvent.click(gear());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
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
      <SettingsMenu shortcuts={READER_SHORTCUTS} storage={storage} />
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
