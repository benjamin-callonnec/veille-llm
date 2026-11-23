import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeSource } from "../pdf/fakeSource";
import { FileViewer } from "./FileViewer";
import * as api from "./reportsApi";

vi.mock("./reportsApi", async (orig) => ({
  ...(await orig<typeof api>()),
  getReport: vi.fn(),
  restoreReport: vi.fn(),
}));

const view = (version: number, html: string): api.ReportView => ({
  id: 1,
  title: "Deck",
  version,
  versions: [
    { version: 1, created_at: "2026-11-23T10:00:00Z" },
    { version: 2, created_at: "2026-11-23T11:00:00Z" },
  ],
  html,
});
const metas: api.ReportMeta[] = [{ id: 1, title: "Deck", version: 2, updated_at: "" }];

beforeEach(() => {
  vi.mocked(api.getReport).mockImplementation(async (_i, _id, v) =>
    view(v ?? 2, `<p>v${v ?? 2}</p>`),
  );
  vi.mocked(api.restoreReport).mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const setup = (over: Partial<Parameters<typeof FileViewer>[0]> = {}) => {
  const h = { onSelect: vi.fn(), onClose: vi.fn(), onChanged: vi.fn() };
  render(<FileViewer itemId="a" reports={metas} selectedId={1} {...h} {...over} />);
  return h;
};

test("shows the latest version in a sandboxed frame", async () => {
  setup();
  const frame = await screen.findByTitle("Deck");
  await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("<p>v2</p>"));
});

test("choosing another version loads it", async () => {
  setup();
  await screen.findByTitle("Deck");
  await userEvent.selectOptions(screen.getByLabelText("Version"), "1");
  await waitFor(() =>
    expect(screen.getByTitle("Deck").getAttribute("srcdoc")).toContain("<p>v1</p>"),
  );
  expect(api.getReport).toHaveBeenLastCalledWith("a", 1, 1);
});

test("restore is offered for an old version only, and tells the page", async () => {
  const h = setup();
  await screen.findByTitle("Deck");
  expect(screen.queryByRole("button", { name: "Restore this version" })).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText("Version"), "1");
  await userEvent.click(await screen.findByRole("button", { name: "Restore this version" }));
  expect(api.restoreReport).toHaveBeenCalledWith("a", 1, 1);
  await waitFor(() => expect(h.onChanged).toHaveBeenCalled());
});

test("export points at the chosen version", async () => {
  setup();
  await screen.findByTitle("Deck");
  expect(screen.getByRole("link", { name: "Export" }).getAttribute("href")).toBe(
    "/api/items/a/reports/1/export?version=2",
  );
});

test("full screen toggles a class, Esc and the close button close", async () => {
  const h = setup();
  await screen.findByTitle("Deck");
  const root = screen.getByRole("region", { name: "Viewer" });
  await userEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(root.className).toContain("fullscreen");
  await userEvent.keyboard("{Escape}");
  expect(h.onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Close the viewer" }));
  expect(h.onClose).toHaveBeenCalledTimes(2);
});

test("with no report there is an empty state", () => {
  setup({ reports: [], selectedId: null });
  expect(screen.getByText(/no report yet/i)).toBeTruthy();
});

test("a report that cannot be loaded clears the view instead of showing the old one", async () => {
  setup();
  const frame = await screen.findByTitle("Deck");
  await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("<p>v2</p>"));
  vi.mocked(api.getReport).mockResolvedValue(null);
  await userEvent.selectOptions(screen.getByLabelText("Version"), "1");
  await waitFor(() => expect(screen.queryByTitle("Deck")).toBeNull());
});

test("Esc that something else already handled does not close the viewer", async () => {
  const h = setup();
  await screen.findByTitle("Deck");
  const other = (e: KeyboardEvent) => e.key === "Escape" && e.preventDefault();
  document.body.addEventListener("keydown", other);
  await userEvent.keyboard("{Escape}");
  document.body.removeEventListener("keydown", other);
  expect(h.onClose).not.toHaveBeenCalled();
});

test("V or Escape typed inside the page (it has the focus) close the viewer", async () => {
  const h = setup();
  const frame = await screen.findByTitle("Deck");
  fireEvent(
    window,
    new MessageEvent("message", {
      data: { veilleKey: "v" },
      source: (frame as HTMLIFrameElement).contentWindow,
    }),
  );
  expect(h.onClose).toHaveBeenCalledTimes(1);
});

test("closed (open=false) it is hidden but still mounted, and Esc does nothing", async () => {
  const h = setup({ open: false });
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  expect(document.querySelector(".viewer")?.hasAttribute("hidden")).toBe(true);
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
  await userEvent.keyboard("{Escape}");
  expect(h.onClose).not.toHaveBeenCalled();
});

// --- the preview of a citation ----------------------------------------------------------

const say = (data: unknown) =>
  fireEvent(
    window,
    new MessageEvent("message", {
      data,
      source: (screen.getByTitle("Deck") as HTMLIFrameElement).contentWindow,
    }),
  );
const preview = () => screen.queryByLabelText("Preview of the paper");

const withSource = (over: Partial<Parameters<typeof FileViewer>[0]> = {}) => {
  const onOpenPdf = vi.fn();
  const h = setup({ source: new FakeSource({ numPages: 5 }), onOpenPdf, ...over });
  return { ...h, onOpenPdf };
};
// the page in the viewer has the focus: a key of the app's window is simulated on the body
const pressEscape = () => fireEvent.keyDown(document.body, { key: "Escape" });

test("a citation clicked in the page opens the preview, a click elsewhere closes it", async () => {
  withSource();
  await screen.findByTitle("Deck");
  expect(preview()).toBeNull();
  say({ veilleCite: { page: 4 } });
  expect(preview()).not.toBeNull();
  say({ veilleCite: null });
  expect(preview()).toBeNull();
});

test("a malformed or out of range citation is ignored", async () => {
  withSource();
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 99999 } });
  say({ veilleCite: { page: 6 } }); // the paper has 5 pages
  say({ veilleCite: { page: 2, quote: "x" } });
  say({ veilleCite: 3 });
  expect(preview()).toBeNull();
});

test("without a PDF the page bound is wide and the card says there is no PDF", async () => {
  setup({ source: null });
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 40 } });
  expect(preview()).not.toBeNull();
  expect(screen.getByRole("status").textContent).toBe("No PDF for this paper");
});

test("Esc closes the preview first and the viewer next", async () => {
  const h = withSource();
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 4 } });
  pressEscape();
  expect(preview()).toBeNull();
  expect(h.onClose).not.toHaveBeenCalled();
  pressEscape();
  expect(h.onClose).toHaveBeenCalledTimes(1);
});

test("Esc typed inside the page does the same, V closes the viewer at once", async () => {
  const h = withSource();
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 4 } });
  say({ veilleKey: "Escape" });
  expect(preview()).toBeNull();
  expect(h.onClose).not.toHaveBeenCalled();
  say({ veilleKey: "v" });
  expect(h.onClose).toHaveBeenCalledTimes(1);
});

test("closing the viewer drops the preview", async () => {
  const props = {
    itemId: "a",
    reports: metas,
    selectedId: 1,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onChanged: vi.fn(),
  };
  const source = new FakeSource({ numPages: 5 });
  const { rerender } = render(<FileViewer {...props} source={source} open />);
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 4 } });
  expect(preview()).not.toBeNull();
  rerender(<FileViewer {...props} source={source} open={false} />);
  rerender(<FileViewer {...props} source={source} open />);
  expect(preview()).toBeNull();
});

test("choosing another version drops the preview", async () => {
  withSource();
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 4 } });
  await userEvent.selectOptions(screen.getByLabelText("Version"), "1");
  await waitFor(() => expect(preview()).toBeNull());
});

test("Open in the PDF hands the citation over and drops the card", async () => {
  const h = withSource();
  await screen.findByTitle("Deck");
  say({ veilleCite: { page: 4, quote: "an exact quote" } });
  await userEvent.click(screen.getByRole("button", { name: "Open in the PDF" }));
  expect(h.onOpenPdf).toHaveBeenCalledWith({ page: 4, quote: "an exact quote" });
  expect(preview()).toBeNull();
});
