import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeSource } from "../pdf/fakeSource";
import type { Caption } from "../structureApi";
import { CitationPeek } from "./CitationPeek";
import type { CiteRef } from "./peek";

beforeEach(() => {
  // jsdom has no 2D canvas: the card must cope with that
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noCaptions = async (): Promise<Caption[]> => [];
const figure = (page: number, number = "2"): Caption => ({
  kind: "figure",
  number,
  page,
  rect: [0.1, 0.4, 0.5, 0.03],
});

function setup(cite: CiteRef, over: Partial<Parameters<typeof CitationPeek>[0]> = {}) {
  const props = {
    cite,
    source: new FakeSource({ numPages: 5 }) as FakeSource | null,
    captions: noCaptions,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const view = render(<CitationPeek {...props} />);
  return { props, view };
}

const status = () => screen.queryByRole("status")?.textContent ?? null;

test("an extract that is on the page: the page is drawn and nothing is said", async () => {
  const { props } = setup({ page: 2, quote: "Text of page 2" });
  const source = props.source as FakeSource;
  await waitFor(() => expect(source.renders).toHaveLength(1));
  expect(source.renders[0]?.page).toBe(2);
  expect(screen.getByText("p.2")).toBeTruthy();
  expect(status()).toBeNull();
});

test("an extract that is not on the page says so, and shows the page", async () => {
  const { props } = setup({ page: 2, quote: "words that are nowhere on this page" });
  await waitFor(() => expect(status()).toBe("Passage not located"));
  expect((props.source as FakeSource).renders[0]?.page).toBe(2);
});

test("a page alone shows its top and says that no passage was cited", async () => {
  const { props } = setup({ page: 3 });
  await waitFor(() => expect((props.source as FakeSource).renders).toHaveLength(1));
  await waitFor(() => expect(status()).toBe("Page only: no passage was cited"));
});

test("a figure found in the captions is drawn, on the page where it is", async () => {
  const { props } = setup(
    { page: 2, label: { kind: "figure", number: "2" } },
    { captions: async () => [figure(4)] },
  );
  const source = props.source as FakeSource;
  await waitFor(() => expect(source.renders.at(-1)?.page).toBe(4));
  expect(screen.getByText("p.4")).toBeTruthy();
  expect(status()).toBeNull();
});

test("a figure that is not in the captions says so", async () => {
  setup({ page: 2, label: { kind: "figure", number: "9" } }, { captions: async () => [figure(4)] });
  await waitFor(() => expect(status()).toBe("Passage not located"));
});

test("without a PDF there is a plain message", () => {
  setup({ page: 2 }, { source: null });
  expect(status()).toBe("No PDF for this paper");
});

test("a render that fails or a page with no size gives a message, never an exception", async () => {
  const failing = new FakeSource();
  failing.render = async () => {
    throw new Error("boom");
  };
  setup({ page: 1 }, { source: failing });
  await waitFor(() => expect(status()).toBe("The preview could not be drawn"));
  cleanup();
  setup({ page: 1 }, { source: new FakeSource({ size: { width: 0, height: 800 } }) });
  await waitFor(() => expect(status()).toBe("The preview could not be drawn"));
});

test("a new citation cancels the render in progress", async () => {
  const source = new FakeSource({ numPages: 5 });
  let release: () => void = () => {};
  const slow = new Promise<void>((r) => {
    release = r;
  });
  const real = source.render.bind(source);
  source.render = async (page, canvas, scale, signal) => {
    await real(page, canvas, scale, signal);
    if (page === 1) await slow;
  };
  const { view, props } = setup({ page: 1 }, { source });
  await waitFor(() => expect(source.renders).toHaveLength(1));
  view.rerender(<CitationPeek {...props} cite={{ page: 2 }} />);
  await waitFor(() => expect(source.renders).toHaveLength(2));
  expect(source.renders[0]?.signal?.aborted).toBe(true);
  release();
  await waitFor(() => expect(screen.getByText("p.2")).toBeTruthy());
  expect(status()).toBe("Page only: no passage was cited"); // page 2 was cited without a passage
});

test("Open in the PDF and the close button call back with the citation", async () => {
  const cite: CiteRef = { page: 2, quote: "Text of page 2" };
  const { props } = setup(cite);
  await userEvent.click(screen.getByRole("button", { name: "Open in the PDF" }));
  expect(props.onOpen).toHaveBeenCalledWith(cite);
  await userEvent.click(screen.getByRole("button", { name: "Close the preview" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

// --- the whole page, scrollable, at the passage, highlighted ------------------------------

const highlights = () => document.querySelectorAll<HTMLElement>(".peek-highlight");

test("the whole page is drawn at the width of the card, not a cut of it", async () => {
  const { props } = setup({ page: 2, quote: "Text of page 2" });
  const source = props.source as FakeSource;
  await waitFor(() => expect(source.renders).toHaveLength(1));
  // a 600pt wide page in a 640px card: the text stays readable
  expect(source.renders[0]?.scale).toBeCloseTo(640 / 600);
});

test("the passage is highlighted where it is on the page, in percent of the page", async () => {
  setup({ page: 2, quote: "Text of page 2" });
  await waitFor(() => expect(highlights()).toHaveLength(1));
  const box = highlights()[0] as HTMLElement;
  // FakeSource: one text box at x=50 y=100 w=200 h=12 on a 600 x 800 page
  expect(Number.parseFloat(box.style.left)).toBeCloseTo((50 / 600) * 100);
  expect(Number.parseFloat(box.style.top)).toBeCloseTo((100 / 800) * 100);
  expect(Number.parseFloat(box.style.width)).toBeCloseTo((200 / 600) * 100);
  expect(Number.parseFloat(box.style.height)).toBeCloseTo((12 / 800) * 100);
});

test("a figure is highlighted at its caption", async () => {
  setup({ page: 2, label: { kind: "figure", number: "2" } }, { captions: async () => [figure(2)] });
  await waitFor(() => expect(highlights()).toHaveLength(1));
  expect(Number.parseFloat((highlights()[0] as HTMLElement).style.top)).toBeCloseTo(40);
});

test("nothing is highlighted when the passage is not located, or for a page alone", async () => {
  setup({ page: 2, quote: "words that are nowhere on this page" });
  await waitFor(() => expect(status()).toBe("Passage not located"));
  expect(highlights()).toHaveLength(0);
  cleanup();
  const { props } = setup({ page: 3 });
  await waitFor(() => expect((props.source as FakeSource).renders).toHaveLength(1));
  expect(highlights()).toHaveLength(0);
});

test("the page-only note belongs to the cited page, not to the neighbours", async () => {
  setup({ page: 2 });
  await waitFor(() => expect(status()).toBe("Page only: no passage was cited"));
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(status()).toBeNull());
});

test("the page is scrolled to the passage once it is drawn", async () => {
  const scrolls: number[] = [];
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get: () => 0,
    set: (v: number) => {
      scrolls.push(v);
    },
  });
  const source = new FakeSource({ numPages: 5 });
  source.textLayer = async () => ({
    text: "Text of page 2",
    boxes: [{ text: "Text of page 2", x: 50, y: 400, width: 200, height: 12 }],
  });
  setup({ page: 2, quote: "Text of page 2" }, { source });
  await waitFor(() => expect(highlights()).toHaveLength(1));
  expect(scrolls.at(-1)).toBe(300); // 400 - 300 / 3
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTop");
});

test("the page can be scrolled inside the card", async () => {
  const { props } = setup({ page: 2 });
  await waitFor(() => expect((props.source as FakeSource).renders).toHaveLength(1));
  expect(document.querySelector(".peek-scroll")).not.toBeNull();
});

test("Open in the PDF is an icon: no text in the button", () => {
  setup({ page: 2 });
  const button = screen.getByRole("button", { name: "Open in the PDF" });
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")).not.toBeNull();
});

// --- zoom -----------------------------------------------------------------------------------

const scales = (source: FakeSource) => source.renders.map((r) => r.scale);

test("zoom in and zoom out draw the page again, bigger or smaller", async () => {
  const { props } = setup({ page: 2, quote: "Text of page 2" });
  const source = props.source as FakeSource;
  await waitFor(() => expect(source.renders).toHaveLength(1));
  expect(screen.getByText("100%")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  await waitFor(() => expect(source.renders).toHaveLength(2));
  expect(scales(source)[1]).toBeCloseTo((640 / 600) * 1.25);
  expect(screen.getByText("125%")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  await waitFor(() => expect(source.renders).toHaveLength(4));
  expect(scales(source)[3]).toBeCloseTo((640 / 600) * 0.75);
});

test("the zoom is bounded, and the buttons say so", async () => {
  const { props } = setup({ page: 2 });
  const source = props.source as FakeSource;
  await waitFor(() => expect(source.renders).toHaveLength(1));
  const out = screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement;
  const inn = screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement;
  for (let i = 0; i < 20; i++) if (!inn.disabled) await userEvent.click(inn);
  expect(inn.disabled).toBe(true);
  expect(screen.getByText("300%")).toBeTruthy();
  for (let i = 0; i < 20; i++) if (!out.disabled) await userEvent.click(out);
  expect(out.disabled).toBe(true);
  expect(screen.getByText("50%")).toBeTruthy();
});

test("the zoom is kept for the next citation, and the passage is still highlighted after zooming", async () => {
  const { view, props } = setup({ page: 2, quote: "Text of page 2" });
  await waitFor(() => expect(highlights()).toHaveLength(1));
  await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  await waitFor(() => expect(screen.getByText("125%")).toBeTruthy());
  await waitFor(() => expect(highlights()).toHaveLength(1));
  view.rerender(<CitationPeek {...props} cite={{ page: 3 }} />);
  await waitFor(() => expect((props.source as FakeSource).renders.at(-1)?.page).toBe(3));
  expect(screen.getByText("125%")).toBeTruthy();
});

// --- page navigation ----------------------------------------------------------------------

test("next and previous page draw the neighbour, without the highlight, and come back to it", async () => {
  const { props } = setup({ page: 2, quote: "Text of page 2" });
  const source = props.source as FakeSource;
  await waitFor(() => expect(highlights()).toHaveLength(1));
  expect(screen.getByText("p.2")).toBeTruthy();
  expect(screen.getByText("/ 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(source.renders.at(-1)?.page).toBe(3));
  expect(screen.getByText("p.3")).toBeTruthy();
  expect(highlights()).toHaveLength(0);
  expect(status()).toBeNull(); // the passage belongs to page 2, nothing to say here
  await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
  await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
  await waitFor(() => expect(source.renders.at(-1)?.page).toBe(1));
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(highlights()).toHaveLength(1)); // back on page 2
  expect(screen.getByText("p.2")).toBeTruthy();
});

test("the first and the last page stop the navigation", async () => {
  const { props } = setup({ page: 1 });
  await waitFor(() => expect((props.source as FakeSource).renders).toHaveLength(1));
  expect(
    (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  cleanup();
  const last = setup({ page: 5 });
  await waitFor(() => expect((last.props.source as FakeSource).renders).toHaveLength(1));
  expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("the passage-not-located note belongs to the cited page only", async () => {
  setup({ page: 2, quote: "words that are nowhere on this page" });
  await waitFor(() => expect(status()).toBe("Passage not located"));
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(status()).toBeNull());
});

test("a new citation starts again on its own page, keeping the zoom", async () => {
  const { view, props } = setup({ page: 2, quote: "Text of page 2" });
  const source = props.source as FakeSource;
  await waitFor(() => expect(highlights()).toHaveLength(1));
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  await waitFor(() => expect(screen.getByText("125%")).toBeTruthy());
  view.rerender(<CitationPeek {...props} cite={{ page: 4 }} />);
  await waitFor(() => expect(source.renders.at(-1)?.page).toBe(4));
  expect(screen.getByText("p.4")).toBeTruthy();
  expect(screen.getByText("125%")).toBeTruthy();
});

test("without a PDF there is no navigation to offer", () => {
  setup({ page: 2 }, { source: null });
  expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
