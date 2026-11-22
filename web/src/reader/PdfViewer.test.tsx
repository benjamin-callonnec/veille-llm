import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, type Mock, test, vi } from "vitest";
import { PdfViewer } from "./PdfViewer";
import { FakeSource } from "./pdf/fakeSource";

const HEIGHT = 800;

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => HEIGHT,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setup = (over: Partial<Parameters<typeof PdfViewer>[0]> = {}, source = new FakeSource()) => {
  const props = {
    source,
    page: 1,
    onPageChange: vi.fn(),
    onSelection: vi.fn(),
    highlights: [],
    ...over,
  };
  const utils = render(<PdfViewer {...props} />);
  return { ...utils, props, source };
};

const scroller = () => screen.getByTestId("pdf-scroll");
const canvases = () => Array.from(document.querySelectorAll("canvas"));

test("a 300 page document only mounts a few pages and releases them when scrolling away", async () => {
  const source = new FakeSource({ numPages: 300 });
  setup({}, source);
  await waitFor(() => expect(canvases().length).toBeGreaterThan(0));
  expect(canvases().length).toBeLessThanOrEqual(4);
  act(() => {
    scroller().scrollTop = 200_000;
    fireEvent.scroll(scroller());
  });
  await waitFor(() => expect(document.querySelector('[data-page="1"] canvas')).toBeNull());
  expect(canvases().length).toBeLessThanOrEqual(4);
  expect(source.renders.length).toBeLessThan(20);
});

test("zoom buttons and keys change the scale and are remembered", async () => {
  const { source } = setup();
  await waitFor(() => expect(source.renders.length).toBeGreaterThan(0));
  expect(screen.getByText("100%")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("125%")).toBeTruthy();
  scroller().focus();
  await userEvent.keyboard("-");
  await userEvent.keyboard("-");
  expect(screen.getByText("75%")).toBeTruthy();
  expect(memory.get("veille-reader-zoom")).toBe("0.75");
});

test("zoom is clamped between 50 and 300 percent", async () => {
  setup();
  const out = screen.getByRole("button", { name: "Zoom out" });
  for (let i = 0; i < 20; i++) await userEvent.click(out);
  expect(screen.getByText("50%")).toBeTruthy();
  const zin = screen.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 30; i++) await userEvent.click(zin);
  expect(screen.getByText("300%")).toBeTruthy();
});

test("PageDown, PageUp and the page field ask for another page", async () => {
  const { props } = setup({ page: 2 });
  scroller().focus();
  await userEvent.keyboard("{PageDown}");
  expect(props.onPageChange).toHaveBeenLastCalledWith(3);
  await userEvent.keyboard("{PageUp}");
  expect(props.onPageChange).toHaveBeenLastCalledWith(1);
  const field = screen.getByRole("spinbutton", { name: "Page" });
  await userEvent.clear(field);
  await userEvent.type(field, "3{Enter}");
  expect(props.onPageChange).toHaveBeenLastCalledWith(3);
});

test("a page outside the document is ignored", async () => {
  const { props } = setup({ page: 1 });
  scroller().focus();
  await userEvent.keyboard("{PageUp}");
  expect(props.onPageChange).not.toHaveBeenCalled();
});

test("changing the page prop scrolls to that page", async () => {
  const source = new FakeSource({ numPages: 10 });
  const { rerender, props } = setup({}, source);
  await waitFor(() => expect(canvases().length).toBeGreaterThan(0));
  rerender(<PdfViewer {...props} page={4} />);
  await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(2000));
});

const selectIn = (el: Element) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
};

test("selecting text reports a normalised quote and clearing it reports null", async () => {
  Range.prototype.getClientRects = () =>
    [{ x: 160, y: 130, width: 100, height: 20 }] as unknown as DOMRectList;
  const { props } = setup();
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
  selectIn(span);
  fireEvent.mouseUp(scroller());
  const call = (props.onSelection as Mock).mock.calls.at(-1)?.[0];
  expect(call.quote.page).toBe(1);
  expect(call.quote.text).toBe("Text of page 1");
  expect(call.quote.rects[0].map((n: number) => Math.round(n * 10000) / 10000)).toEqual([
    0.1, 0.0375, 0.1667, 0.025,
  ]);
  window.getSelection()?.removeAllRanges();
  fireEvent.mouseUp(scroller());
  expect(props.onSelection).toHaveBeenLastCalledWith(null);
});

test("highlights are drawn at their normalised position with their colour", async () => {
  setup({ highlights: [{ id: 7, page: 1, color: "green", rects: [[0.1, 0.2, 0.3, 0.05]] }] });
  const hl = await waitFor(() => {
    const el = document.querySelector('[data-highlight="7"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  expect(hl.className).toContain("hl-green");
  expect(hl.style.left).toBe("10%");
  expect(hl.style.top).toBe("20%");
  expect(hl.style.width).toBe("30%");
  expect(hl.style.height).toBe("5%");
});

test("paper text containing markup is shown as text", async () => {
  const source = new FakeSource({ text: () => "<script>alert(1)</script>" });
  setup({}, source);
  expect(await screen.findAllByText("<script>alert(1)</script>")).not.toHaveLength(0);
  expect(document.querySelector("script")).toBeNull();
});

test("never renders links from the PDF", async () => {
  setup();
  await waitFor(() => expect(canvases().length).toBeGreaterThan(0));
  expect(document.querySelector("a[href]")).toBeNull();
});

test("the slash key opens the search and matches are marked in the text", async () => {
  const source = new FakeSource({ text: () => "The needle is here" });
  setup({}, source);
  scroller().focus();
  await userEvent.keyboard("/");
  const box = await screen.findByRole("searchbox", { name: "Search" });
  await userEvent.type(box, "needle");
  await waitFor(() => expect(document.querySelector(".pdf-match")).not.toBeNull());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("searchbox", { name: "Search" })).toBeNull();
  expect(document.querySelector(".pdf-match")).toBeNull();
});

test("each text piece is stretched to the width pdf.js measured", async () => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 100,
  });
  try {
    setup();
    const span = await screen.findByText("Text of page 1");
    // the fake box is 200 wide at scale 1 and the natural width is 100
    await waitFor(() => expect((span as HTMLElement).style.transform).toBe("scaleX(2)"));
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  }
});
