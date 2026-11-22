import { describe, expect, test } from "vitest";
import { pageOffsets, visibleWindow } from "./pages";

const heights = Array.from({ length: 300 }, () => 800);

test("offsets include the gap", () => {
  expect(pageOffsets([100, 200, 50], 10)).toEqual([0, 110, 320]);
});

describe("visibleWindow", () => {
  test("top of the document", () => {
    expect(visibleWindow(0, 1000, heights, 8, 1)).toEqual({ first: 0, last: 2 });
  });
  test("middle", () => {
    const w = visibleWindow(150 * 808, 1000, heights, 8, 1);
    expect(w.last - w.first + 1).toBeLessThanOrEqual(5);
    expect(w.first).toBeLessThanOrEqual(150);
    expect(w.last).toBeGreaterThanOrEqual(150);
  });
  test("bottom never leaves the document", () => {
    const w = visibleWindow(10_000_000, 1000, heights, 8, 2);
    expect(w.last).toBe(299);
    expect(w.first).toBeGreaterThanOrEqual(0);
  });
  test("window stays bounded wherever we scroll", () => {
    for (const top of [0, 5000, 120_000, 240_000, 242_000]) {
      const w = visibleWindow(top, 1000, heights, 8, 1);
      expect(w.last - w.first + 1).toBeLessThanOrEqual(6);
    }
  });
  test("empty document", () => {
    expect(visibleWindow(0, 1000, [], 8, 1)).toEqual({ first: 0, last: -1 });
  });
});
