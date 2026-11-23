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

test("a page alone shows its top without saying anything", async () => {
  const { props } = setup({ page: 3 });
  await waitFor(() => expect((props.source as FakeSource).renders).toHaveLength(1));
  expect(status()).toBeNull();
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
  expect(status()).toBeNull();
});

test("Open in the PDF and the close button call back with the citation", async () => {
  const cite: CiteRef = { page: 2, quote: "Text of page 2" };
  const { props } = setup(cite);
  await userEvent.click(screen.getByRole("button", { name: "Open in the PDF" }));
  expect(props.onOpen).toHaveBeenCalledWith(cite);
  await userEvent.click(screen.getByRole("button", { name: "Close the preview" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
