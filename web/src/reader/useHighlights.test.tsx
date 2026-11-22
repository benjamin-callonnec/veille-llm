import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { type Highlight, type HighlightsApi, useHighlights } from "./useHighlights";

const fakeApi = (initial: Highlight[] = []): HighlightsApi & { rows: Highlight[] } => {
  const rows = [...initial];
  return {
    rows,
    list: async () => [...rows],
    add: async (_item, body) => {
      const row = { id: rows.length + 10, created_at: "now", ...body };
      rows.push(row);
      return row;
    },
    remove: async (_item, id) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      );
    },
  };
};

test("loads, adds and removes", async () => {
  const api = fakeApi([{ id: 1, page: 2, color: "red", text: "t", rects: [], created_at: "x" }]);
  const { result } = renderHook(() => useHighlights("a1", api));
  await waitFor(() => expect(result.current.highlights).toHaveLength(1));
  await act(() => result.current.add(1, "yellow", "new", [[0, 0, 1, 1]]));
  expect(result.current.highlights.map((h) => h.page)).toEqual([1, 2]);
  await act(() => result.current.remove(1));
  expect(result.current.highlights).toHaveLength(1);
});

test("reports errors without throwing", async () => {
  const api: HighlightsApi = {
    list: async () => {
      throw new Error("down");
    },
    add: async () => {
      throw new Error("down");
    },
    remove: async () => {
      throw new Error("down");
    },
  };
  const { result } = renderHook(() => useHighlights("a1", api));
  await waitFor(() => expect(result.current.error).toBe(true));
  await act(() => result.current.add(1, "red", "t", []));
  expect(result.current.highlights).toEqual([]);
});
