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

test("the search button is an icon with a name and a tooltip, and opens the search", async () => {
  setup();
  const button = await screen.findByRole("button", { name: "Search" });
  expect(button.textContent).toBe("");
  expect(button.getAttribute("title")).toMatch(/Search/);
  await userEvent.click(button);
  expect(await screen.findByRole("searchbox", { name: "Search" })).toBeTruthy();
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

test("scrolling into pages never snaps the scroll position back", async () => {
  const source = new FakeSource({ numPages: 300 });
  setup({}, source);
  await waitFor(() => expect(canvases().length).toBeGreaterThan(0));
  act(() => {
    scroller().scrollTop = 3648; // the middle of page 5
    fireEvent.scroll(scroller());
  });
  await new Promise((r) => setTimeout(r, 60));
  expect(scroller().scrollTop).toBe(3648);
});

test("a render in progress is cancelled when the zoom changes", async () => {
  const { source } = setup();
  await waitFor(() => expect(source.renders.length).toBeGreaterThan(0));
  const first = source.renders[0]?.signal;
  expect(first?.aborted).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(first?.aborted).toBe(true);
});

test("pages that leave the window are released", async () => {
  const source = new FakeSource({ numPages: 300 });
  setup({}, source);
  await waitFor(() => expect(canvases().length).toBeGreaterThan(0));
  act(() => {
    scroller().scrollTop = 200_000;
    fireEvent.scroll(scroller());
  });
  await waitFor(() => expect(source.released).toContain(1));
});

test("scrolled to the very bottom the last page is reported", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 8120,
  });
  try {
    const source = new FakeSource({ numPages: 10 });
    const { props } = setup({}, source);
    await waitFor(() => expect(canvases().length).toBeGreaterThan(0));
    act(() => {
      scroller().scrollTop = 8120 - HEIGHT; // the browser cannot go further
      fireEvent.scroll(scroller());
    });
    expect(props.onPageChange).toHaveBeenLastCalledWith(10);
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  }
});

const flashes = () => Array.from(document.querySelectorAll("[data-flash]"));

test("a flash draws the located quote on its page, then ends and tells the parent", async () => {
  const onTargetDone = vi.fn();
  setup({
    page: 2,
    target: { page: 2, quote: "Text of page 2", nonce: 1 },
    flashMs: 250,
    onTargetDone,
  });
  await waitFor(() => expect(flashes().length).toBe(1));
  const el = flashes()[0] as HTMLElement;
  expect(el.className).toContain("hl-flash");
  expect(el.closest('[data-page="2"]')).not.toBeNull();
  expect(Number.parseFloat(el.style.left)).toBeCloseTo((50 / 600) * 100, 2);
  expect(onTargetDone).not.toHaveBeenCalled();
  await waitFor(() => expect(onTargetDone).toHaveBeenCalledTimes(1));
  expect(flashes()).toHaveLength(0);
});

test("a quote that is not on the page flashes nothing", async () => {
  const onTargetDone = vi.fn();
  setup({
    target: { page: 1, quote: "words that are nowhere to be seen", nonce: 1 },
    flashMs: 250,
    onTargetDone,
  });
  await waitFor(() => expect(document.querySelector(".pdf-text-layer span")).not.toBeNull());
  expect(flashes()).toHaveLength(0);
});

test("a new nonce restarts the flash", async () => {
  const onTargetDone = vi.fn();
  const source = new FakeSource();
  const base = { source, page: 1, onPageChange: vi.fn(), onSelection: vi.fn(), highlights: [] };
  const target = { page: 1, quote: "Text of page 1", nonce: 1 };
  const { rerender } = render(
    <PdfViewer {...base} target={target} flashMs={400} onTargetDone={onTargetDone} />,
  );
  await waitFor(() => expect(flashes().length).toBe(1));
  await new Promise((r) => setTimeout(r, 250));
  rerender(
    <PdfViewer
      {...base}
      target={{ ...target, nonce: 2 }}
      flashMs={400}
      onTargetDone={onTargetDone}
    />,
  );
  await new Promise((r) => setTimeout(r, 250));
  // 500 ms after the first flash started, yet the restarted one is still showing
  expect(onTargetDone).not.toHaveBeenCalled();
  expect(flashes()).toHaveLength(1);
  await waitFor(() => expect(onTargetDone).toHaveBeenCalledTimes(1));
});

test("without a flash nothing is drawn", async () => {
  setup();
  await waitFor(() => expect(document.querySelector(".pdf-text-layer span")).not.toBeNull());
  expect(flashes()).toHaveLength(0);
});

test("a target with rects scrolls the page so the box sits a third from the top", async () => {
  setup({ page: 2, target: { page: 2, rects: [[0.1, 0.5, 0.3, 0.02]], nonce: 1 } });
  // page 2 starts at 800 + 12 (gap); its box is 400 px down; the viewport is 800 px high
  await waitFor(() => expect(scroller().scrollTop).toBeCloseTo(812 + 400 - 800 / 3, 0));
});

test("a target near the top of its page never scrolls above the page", async () => {
  setup({ page: 2, target: { page: 2, rects: [[0.1, 0.01, 0.3, 0.02]], nonce: 1 } });
  await waitFor(() => expect(flashes().length).toBe(1));
  expect(scroller().scrollTop).toBe(812);
});

test("a target with rects flashes them without needing the text layer", async () => {
  setup(
    { page: 2, target: { page: 2, rects: [[0.1, 0.5, 0.3, 0.02]], nonce: 1 } },
    new FakeSource({ failTextOn: [2] }),
  );
  await waitFor(() => expect(flashes().length).toBe(1));
  expect(flashes()[0]?.closest('[data-page="2"]')).not.toBeNull();
});

test("a target with empty rects flashes nothing and tells the parent", async () => {
  const onTargetDone = vi.fn();
  setup({ target: { page: 1, rects: [], nonce: 1 }, onTargetDone });
  await waitFor(() => expect(onTargetDone).toHaveBeenCalledTimes(1));
  expect(flashes()).toHaveLength(0);
});
