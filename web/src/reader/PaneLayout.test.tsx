import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PaneLayout } from "./PaneLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setup = (storage?: Storage | null) =>
  render(<PaneLayout pdf={<p>PDF pane</p>} chat={<p>Chat pane</p>} storage={storage} />);

const sep = () => screen.getByRole("separator");

test("shows both panes at 60 percent", () => {
  setup(null);
  expect(screen.getByText("PDF pane")).toBeTruthy();
  expect(screen.getByText("Chat pane")).toBeTruthy();
  expect(sep().getAttribute("aria-valuenow")).toBe("60");
});

test("hiding the chat leaves the PDF and the button flips", async () => {
  setup(null);
  await userEvent.click(screen.getByRole("button", { name: "Hide chat" }));
  expect(screen.queryByText("Chat pane")).toBeNull();
  expect(screen.getByText("PDF pane")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show chat" })).toBeTruthy();
});

test("hiding the PDF while the chat is hidden shows the chat again", async () => {
  setup(null);
  await userEvent.click(screen.getByRole("button", { name: "Hide chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Hide PDF" }));
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
  await userEvent.click(screen.getByRole("button", { name: "Hide chat" }));
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
  await userEvent.click(screen.getByRole("button", { name: "Hide chat" }));
  expect(screen.getByText("PDF pane")).toBeTruthy();
});
