import { expect, test } from "vitest";
import { CATALOGUE_SHORTCUTS, READER_SHORTCUTS } from "./shortcuts";

test("the reader lists the pane shortcuts PaneLayout really uses (B and J, which Chrome does not take)", () => {
  const panes = READER_SHORTCUTS.find((g) => g.title === "Panes");
  const labels = panes?.entries.map((e) => `${e.keys.join("+")}:${e.label}`) ?? [];
  expect(labels).toContain("Mod+B:Toggle the PDF pane");
  expect(labels).toContain("Mod+J:Toggle the chat pane");
});

test("every group has a title and entries with keys and a label", () => {
  for (const group of [...READER_SHORTCUTS, ...CATALOGUE_SHORTCUTS]) {
    expect(group.title).not.toBe("");
    for (const entry of group.entries) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.label).not.toBe("");
    }
  }
});

test("the catalogue lists the search shortcut and the help key", () => {
  const all = CATALOGUE_SHORTCUTS.flatMap((g) =>
    g.entries.map((e) => `${e.keys.join("+")}:${e.label}`),
  );
  expect(all).toContain("/:Search the catalogue");
  expect(all).toContain("?:Show or hide the settings");
});

test("both pages list the shortcut to go home", () => {
  for (const groups of [CATALOGUE_SHORTCUTS, READER_SHORTCUTS]) {
    const all = groups.flatMap((g) => g.entries.map((e) => `${e.keys.join("+")}:${e.label}`));
    expect(all).toContain("H:Go to the home page (catalogue)");
  }
});

test("the reader lists the viewer shortcuts", () => {
  const viewer = READER_SHORTCUTS.find((g) => g.title === "Viewer");
  const labels = viewer?.entries.map((e) => `${e.keys.join("+")}:${e.label}`) ?? [];
  expect(labels).toEqual(["V:Open or close the viewer", "Esc:Close the viewer"]);
});
