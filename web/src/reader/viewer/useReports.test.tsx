import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ReportMeta } from "./reportsApi";
import { useReports } from "./useReports";

const meta = (id: number, version = 1): ReportMeta => ({
  id,
  title: `R${id}`,
  version,
  updated_at: "",
});

test("loads the reports of the paper, and reload reads them again", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce([meta(1)])
    .mockResolvedValueOnce([meta(2), meta(1)]);
  const { result } = renderHook(() => useReports("a1", list));
  await waitFor(() => expect(result.current.reports).toEqual([meta(1)]));
  let found: ReportMeta[] = [];
  await act(async () => {
    found = await result.current.reload();
  });
  expect(found.map((r) => r.id)).toEqual([2, 1]);
  expect(result.current.reports.map((r) => r.id)).toEqual([2, 1]);
  expect(list).toHaveBeenCalledWith("a1");
});
