import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PaneLayout } from "./PaneLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setup = (storage?: Storage | null, platform: "mac" | "other" = "other") =>
  render(
    <PaneLayout
      pdf={<p>PDF pane</p>}
      chat={<p>Chat pane</p>}
      storage={storage}
      platform={platform}
    />,
  );

const sep = () => screen.getByRole("separator");

test("shows both panes at 60 percent", () => {
  setup(null);
  expect(screen.getByText("PDF pane")).toBeTruthy();
  expect(screen.getByText("Chat pane")).toBeTruthy();
  expect(sep().getAttribute("aria-valuenow")).toBe("60");
});

test("collapsing the chat leaves the PDF and a discreet control to expand it", async () => {
  setup(null);
  await userEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  expect(screen.queryByText("Chat pane")).toBeNull();
  expect(screen.getByText("PDF pane")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Expand chat" })).toBeTruthy();
});

test("collapsing the PDF while the chat is collapsed shows the chat again", async () => {
  setup(null);
  await userEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Collapse PDF" }));
  expect(screen.getByText("Chat pane")).toBeTruthy();
  expect(screen.queryByText("PDF pane")).toBeNull();
});

test("arrow keys move the separator and clamp", async () => {
  setup(null);
  sep().focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(sep().getAttribute("aria-valuenow")).toBe("62");
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  expect(sep().getAttribute("aria-valuenow")).toBe("58");
  for (let i = 0; i < 40; i++) await userEvent.keyboard("{ArrowRight}");
  expect(sep().getAttribute("aria-valuenow")).toBe("80");
  for (let i = 0; i < 60; i++) await userEvent.keyboard("{ArrowLeft}");
  expect(sep().getAttribute("aria-valuenow")).toBe("25");
});

test("dragging sets the ratio from the pointer position", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 1000,
    top: 0,
    height: 500,
    right: 1000,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  setup(null);
  fireEvent.pointerDown(sep(), { clientX: 600, pointerId: 1 });
  fireEvent.pointerMove(sep(), { clientX: 400, pointerId: 1 });
  expect(sep().getAttribute("aria-valuenow")).toBe("40");
  fireEvent.pointerUp(sep(), { pointerId: 1 });
  fireEvent.pointerMove(sep(), { clientX: 700, pointerId: 1 });
  expect(sep().getAttribute("aria-valuenow")).toBe("40");
});

test("restores and saves the layout through storage", async () => {
  const data: Record<string, string> = {
    "veille-reader-panes": JSON.stringify({
      ratio: 0.4,
      pdfCollapsed: false,
      chatCollapsed: false,
    }),
  };
  const storage = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  } as unknown as Storage;
  setup(storage);
  expect(sep().getAttribute("aria-valuenow")).toBe("40");
  await userEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  expect(JSON.parse(data["veille-reader-panes"] ?? "{}").chatCollapsed).toBe(true);
});

test("works when storage throws", async () => {
  const storage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  } as unknown as Storage;
  setup(storage);
  await userEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  expect(screen.getByText("PDF pane")).toBeTruthy();
});

test("there are no Hide/Show text buttons any more, only discreet cross controls", () => {
  setup(null);
  expect(screen.queryByRole("button", { name: /^(Hide|Show) / })).toBeNull();
  const cross = screen.getByRole("button", { name: "Collapse chat" });
  expect(cross.textContent).toBe("×");
});

test("a collapsed pane leaves a thin rail with a control to expand it", async () => {
  setup(null);
  await userEvent.click(screen.getByRole("button", { name: "Collapse PDF" }));
  expect(screen.queryByText("PDF pane")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Expand PDF" }));
  expect(screen.getByText("PDF pane")).toBeTruthy();
  expect(screen.getByText("Chat pane")).toBeTruthy();
});

test("Ctrl+B toggles the PDF and Ctrl+J toggles the chat on Windows and Linux", async () => {
  setup(null, "other");
  await userEvent.keyboard("{Control>}j{/Control}");
  expect(screen.queryByText("Chat pane")).toBeNull();
  await userEvent.keyboard("{Control>}j{/Control}");
  expect(screen.getByText("Chat pane")).toBeTruthy();
  await userEvent.keyboard("{Control>}b{/Control}");
  expect(screen.queryByText("PDF pane")).toBeNull();
  await userEvent.keyboard("{Control>}b{/Control}");
  expect(screen.getByText("PDF pane")).toBeTruthy();
});

test("Cmd+B toggles the PDF and Cmd+J toggles the chat on a Mac", async () => {
  setup(null, "mac");
  await userEvent.keyboard("{Meta>}j{/Meta}");
  expect(screen.queryByText("Chat pane")).toBeNull();
  await userEvent.keyboard("{Meta>}j{/Meta}");
  expect(screen.getByText("Chat pane")).toBeTruthy();
  await userEvent.keyboard("{Meta>}b{/Meta}");
  expect(screen.queryByText("PDF pane")).toBeNull();
});

test("the shortcuts never collapse both panes", async () => {
  setup(null, "mac");
  await userEvent.keyboard("{Meta>}j{/Meta}");
  await userEvent.keyboard("{Meta>}b{/Meta}");
  expect(screen.getByText("Chat pane")).toBeTruthy();
  expect(screen.queryByText("PDF pane")).toBeNull();
});

test("browser shortcuts and the other platform's modifier are left alone", async () => {
  setup(null, "mac");
  await userEvent.keyboard("{Meta>}{Shift>}b{/Shift}{/Meta}"); // Chrome: bookmarks bar
  await userEvent.keyboard("{Meta>}{Alt>}j{/Alt}{/Meta}");
  await userEvent.keyboard("{Control>}b{/Control}"); // not the Mac modifier
  await userEvent.keyboard("b");
  expect(screen.getByText("PDF pane")).toBeTruthy();
  expect(screen.getByText("Chat pane")).toBeTruthy();
  cleanup();
  setup(null, "other");
  await userEvent.keyboard("{Meta>}b{/Meta}"); // not the Windows modifier
  await userEvent.keyboard("{Alt>}1{/Alt}");
  expect(screen.getByText("PDF pane")).toBeTruthy();
});

test("the shortcut is taken from the browser (preventDefault) only when it acts", () => {
  setup(null, "other");
  const hit = new KeyboardEvent("keydown", {
    code: "KeyB",
    key: "b",
    ctrlKey: true,
    cancelable: true,
  });
  window.dispatchEvent(hit);
  expect(hit.defaultPrevented).toBe(true);
  const miss = new KeyboardEvent("keydown", {
    code: "KeyK",
    key: "k",
    ctrlKey: true,
    cancelable: true,
  });
  window.dispatchEvent(miss);
  expect(miss.defaultPrevented).toBe(false);
});

test("controls say which shortcut they have, for the platform", () => {
  setup(null, "other");
  expect(screen.getByRole("button", { name: "Collapse PDF" }).getAttribute("title")).toMatch(
    /Ctrl\+B/,
  );
  expect(screen.getByRole("button", { name: "Collapse chat" }).getAttribute("title")).toMatch(
    /Ctrl\+J/,
  );
  cleanup();
  setup(null, "mac");
  expect(screen.getByRole("button", { name: "Collapse PDF" }).getAttribute("title")).toMatch(/⌘B/);
  expect(screen.getByRole("button", { name: "Collapse chat" }).getAttribute("title")).toMatch(/⌘J/);
});
