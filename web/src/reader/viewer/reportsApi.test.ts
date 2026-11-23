import { afterEach, expect, test, vi } from "vitest";
import { exportUrl, getReport, listReports, restoreReport } from "./reportsApi";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => body });

test("listReports gives the list, and nothing when the server fails", async () => {
  vi.stubGlobal("fetch", reply([{ id: 1, title: "T", version: 2, updated_at: "" }]));
  expect(await listReports("a 1")).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith("/api/items/a%201/reports");
  vi.stubGlobal("fetch", reply({}, false, 500));
  expect(await listReports("a")).toEqual([]);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
  expect(await listReports("a")).toEqual([]);
});

test("getReport asks for a version only when given, null when unknown", async () => {
  vi.stubGlobal("fetch", reply({ id: 1 }));
  await getReport("a", 1);
  expect(fetch).toHaveBeenCalledWith("/api/items/a/reports/1");
  await getReport("a", 1, 3);
  expect(fetch).toHaveBeenLastCalledWith("/api/items/a/reports/1?version=3");
  vi.stubGlobal("fetch", reply({}, false, 404));
  expect(await getReport("a", 1)).toBeNull();
});

test("restoreReport posts the version and reports success", async () => {
  vi.stubGlobal("fetch", reply({ id: 1, version: 3 }, true, 201));
  expect(await restoreReport("a", 1, 1)).toBe(true);
  expect(fetch).toHaveBeenCalledWith("/api/items/a/reports/1/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1 }),
  });
  vi.stubGlobal("fetch", reply({}, false, 404));
  expect(await restoreReport("a", 1, 9)).toBe(false);
});

test("exportUrl", () => {
  expect(exportUrl("a", 1)).toBe("/api/items/a/reports/1/export");
  expect(exportUrl("a", 1, 2)).toBe("/api/items/a/reports/1/export?version=2");
});
