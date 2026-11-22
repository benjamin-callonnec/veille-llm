import { describe, expect, test } from "vitest";
import { toPixelRects, toQuote } from "./quote";

const round = (rects: number[][] | undefined) =>
  rects?.map((r) => r.map((n) => Math.round(n * 1e6) / 1e6));

const box = (w: number, h: number) => ({ x: 0, y: 0, width: w, height: h });

describe("toQuote", () => {
  test("normalises rects to the page box", () => {
    const q = toQuote(3, "Hello", [{ x: 50, y: 100, width: 100, height: 20 }], box(500, 1000));
    expect(q?.text).toBe("Hello");
    expect(q?.page).toBe(3);
    expect(round(q?.rects)).toEqual([[0.1, 0.1, 0.2, 0.02]]);
  });

  test("is independent of the zoom", () => {
    const small = toQuote(1, "t", [{ x: 50, y: 100, width: 100, height: 20 }], box(500, 1000));
    const big = toQuote(1, "t", [{ x: 100, y: 200, width: 200, height: 40 }], box(1000, 2000));
    expect(round(big?.rects)).toEqual(round(small?.rects));
  });

  test("uses the page offset", () => {
    const q = toQuote(1, "t", [{ x: 60, y: 510, width: 50, height: 10 }], {
      x: 10,
      y: 500,
      width: 100,
      height: 100,
    });
    expect(q?.rects[0]?.map((n) => Math.round(n * 100) / 100)).toEqual([0.5, 0.1, 0.5, 0.1]);
  });

  test("empty or whitespace text gives no quote", () => {
    expect(toQuote(1, "", [{ x: 0, y: 0, width: 1, height: 1 }], box(10, 10))).toBeNull();
    expect(toQuote(1, " \n\t ", [{ x: 0, y: 0, width: 1, height: 1 }], box(10, 10))).toBeNull();
  });

  test("collapses whitespace", () => {
    const q = toQuote(1, "  a \n  b\t c ", [{ x: 0, y: 0, width: 1, height: 1 }], box(10, 10));
    expect(q?.text).toBe("a b c");
  });

  test("clamps rects to the page and drops empty ones", () => {
    const q = toQuote(
      1,
      "t",
      [
        { x: -10, y: -10, width: 30, height: 30 },
        { x: 5, y: 5, width: 0, height: 4 },
        { x: 90, y: 90, width: 50, height: 50 },
      ],
      box(100, 100),
    );
    expect(round(q?.rects)).toEqual([
      [0, 0, 0.2, 0.2],
      [0.9, 0.9, 0.1, 0.1],
    ]);
  });

  test("no rect left means no quote", () => {
    expect(toQuote(1, "t", [{ x: 500, y: 500, width: 5, height: 5 }], box(100, 100))).toBeNull();
  });
});

test("toPixelRects scales back to a page size", () => {
  expect(toPixelRects([[0.1, 0.2, 0.3, 0.4]], 1000, 500)).toEqual([
    { left: 100, top: 100, width: 300, height: 200 },
  ]);
});

describe("toQuote rectangle merging", () => {
  const page = { x: 0, y: 0, width: 1000, height: 1000 };
  test("pieces of one line are merged into one rectangle", () => {
    const q = toQuote(
      1,
      "t",
      [
        { x: 100, y: 100, width: 100, height: 20 },
        { x: 200, y: 101, width: 100, height: 20 },
      ],
      page,
    );
    expect(q?.rects).toHaveLength(1);
    expect(round(q?.rects)?.[0]).toEqual([0.1, 0.1, 0.2, 0.021]);
  });
  test("a rectangle contained in another is dropped", () => {
    const q = toQuote(
      1,
      "t",
      [
        { x: 100, y: 100, width: 400, height: 20 },
        { x: 150, y: 102, width: 50, height: 16 },
      ],
      page,
    );
    expect(q?.rects).toHaveLength(1);
  });
  test("different lines stay separate", () => {
    const q = toQuote(
      1,
      "t",
      [
        { x: 100, y: 100, width: 100, height: 20 },
        { x: 100, y: 140, width: 100, height: 20 },
      ],
      page,
    );
    expect(q?.rects).toHaveLength(2);
  });
  test("never more than 200 rectangles", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      x: 0,
      y: i * 2,
      width: 10,
      height: 1,
    }));
    expect(toQuote(1, "t", many, page)?.rects.length).toBeLessThanOrEqual(200);
  });
});
