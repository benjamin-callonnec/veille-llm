import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
