import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeSource } from "./pdf/fakeSource";
import { PdfOpenError, type PdfSource } from "./pdf/source";
import { type ReaderItem, ReaderPage } from "./ReaderPage";
import type { Highlight, HighlightsApi } from "./useHighlights";

const item = (over: Partial<ReaderItem> = {}): ReaderItem => ({
  id: "a1",
  title: "Agents at scale",
  hook: "A bold hook.",
  url: "https://arxiv.org/abs/2401.01234",
  type: "paper",
  has_pdf: true,
  ...over,
});

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  window.location.hash = "";
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fakeApi = () => {
  const rows: Highlight[] = [];
  const api: HighlightsApi = {
    list: async () => [...rows],
    add: vi.fn(async (_i, body) => {
      const row = { id: rows.length + 1, created_at: "now", ...body };
      rows.push(row);
      return row;
    }),
    remove: vi.fn(async () => {}),
  };
  return { api, rows };
};

const setup = (
  opts: { open?: () => Promise<PdfSource>; load?: () => Promise<ReaderItem> } = {},
) => {
  const { api, rows } = fakeApi();
  const open = opts.open ?? (async () => new FakeSource({ numPages: 5 }));
  const utils = render(
    <ReaderPage itemId="a1" load={opts.load ?? (async () => item())} open={open} api={api} />,
  );
  return { api, rows, open, ...utils };
};

const select = async () => {
  Range.prototype.getClientRects = () =>
    [{ x: 160, y: 130, width: 100, height: 20 }] as unknown as DOMRectList;
  const span = await screen.findByText("Text of page 1");
  vi.spyOn(span.closest("[data-page]") as Element, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    width: 600,
    height: 800,
    left: 100,
    top: 100,
    right: 700,
    bottom: 900,
    toJSON: () => ({}),
  });
  const range = document.createRange();
  range.selectNodeContents(span);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(screen.getByTestId("pdf-scroll"));
};

test("shows the item and its PDF in two panes", async () => {
  setup();
  expect(await screen.findByRole("heading", { name: "Agents at scale" })).toBeTruthy();
  expect(screen.getByText("A bold hook.")).toBeTruthy();
  expect(await screen.findByText("Text of page 1")).toBeTruthy();
  expect(screen.getByRole("separator")).toBeTruthy();
});

test("says when there is no PDF", async () => {
  const open = vi.fn();
  setup({ load: async () => item({ has_pdf: false }), open });
  expect(await screen.findByText("No PDF for this item")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});

test("shows an error when loading the item fails", async () => {
  setup({
    load: async () => {
      throw new Error("404");
    },
  });
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("shows an error without an item id", async () => {
  render(<ReaderPage itemId="" load={async () => item()} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test.each([
  ["password", /password/i],
  ["invalid", /not a valid PDF/i],
  ["network", /could not be downloaded/i],
] as const)("a %s failure shows a clear message", async (reason, text) => {
  setup({
    open: async () => {
      throw new PdfOpenError(reason);
    },
  });
  expect((await screen.findByRole("alert")).textContent).toMatch(text);
});

test("a title with markup is rendered as text", async () => {
  setup({ load: async () => item({ title: "<script>x</script>" }) });
  expect(await screen.findByText("<script>x</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
});

test("selecting text then asking highlights it in yellow and lists the question", async () => {
  const { api } = setup();
  await select();
  const field = await screen.findByPlaceholderText("Ask about this passage…");
  await userEvent.type(field, "What does this mean?{Enter}");
  await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
  expect((api.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
    page: 1,
    color: "yellow",
    text: "Text of page 1",
  });
  expect(await screen.findByText("What does this mean?")).toBeTruthy();
  expect(screen.queryByPlaceholderText("Ask about this passage…")).toBeNull();
});

test("a colour dot highlights without asking and the highlight survives a remount", async () => {
  const { api, rows, unmount } = setup();
  await select();
  await userEvent.click(await screen.findByRole("button", { name: "Highlight green" }));
  await waitFor(() => expect(rows).toHaveLength(1));
  expect(rows[0]?.color).toBe("green");
  expect(await screen.findByRole("button", { name: "Highlights (1)" })).toBeTruthy();
  unmount();
  render(
    <ReaderPage
      itemId="a1"
      load={async () => item()}
      open={async () => new FakeSource({ numPages: 5 })}
      api={api}
    />,
  );
  expect(await screen.findByRole("button", { name: "Highlights (1)" })).toBeTruthy();
});

test("Escape closes the selection box", async () => {
  setup();
  await select();
  await screen.findByPlaceholderText("Ask about this passage…");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByPlaceholderText("Ask about this passage…")).toBeNull();
});

test("Copy writes the quote to the clipboard", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  setup();
  await select();
  await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("Text of page 1");
});

test("the page in the URL is applied on load and kept up to date", async () => {
  window.location.hash = "#item=a1&page=3";
  setup();
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("3"));
  await userEvent.clear(field);
  await userEvent.type(field, "2{Enter}");
  await waitFor(() => expect(window.location.hash).toBe("#item=a1&page=2"));
});

test("a failed highlight save is reported to the user", async () => {
  const { api } = setup();
  (api.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("422"));
  await select();
  await userEvent.click(await screen.findByRole("button", { name: "Highlight red" }));
  expect((await screen.findByRole("status")).textContent).toMatch(/highlight/i);
});

test("a very long selection is trimmed so the highlight can be saved", async () => {
  const { api } = setup({
    open: async () => new FakeSource({ numPages: 5, text: () => "x".repeat(6000) }),
  });
  Range.prototype.getClientRects = () =>
    [{ x: 160, y: 130, width: 100, height: 20 }] as unknown as DOMRectList;
  const span = (await screen.findAllByText("x".repeat(6000)))[0] as HTMLElement;
  vi.spyOn(span.closest("[data-page]") as Element, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    width: 600,
    height: 800,
    left: 100,
    top: 100,
    right: 700,
    bottom: 900,
    toJSON: () => ({}),
  });
  const range = document.createRange();
  range.selectNodeContents(span);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(screen.getByTestId("pdf-scroll"));
  await userEvent.click(await screen.findByRole("button", { name: "Highlight red" }));
  await waitFor(() => expect(api.add).toHaveBeenCalled());
  const body = (api.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
  expect(body.text.length).toBeLessThanOrEqual(5000);
});
