import { expect, test } from "vitest";
import { cropFor, parseCite } from "./peek";

const cite = (veilleCite: unknown) => ({ veilleCite });

test("a page alone, an extract and a figure are accepted", () => {
  expect(parseCite(cite({ page: 4 }), 10)).toEqual({ page: 4 });
  expect(parseCite(cite({ page: 4, quote: "x".repeat(10) }), 10)).toEqual({
    page: 4,
    quote: "x".repeat(10),
  });
  expect(parseCite(cite({ page: 2, kind: "figure", number: "3.1" }), 10)).toEqual({
    page: 2,
    label: { kind: "figure", number: "3.1" },
  });
  expect(parseCite(cite({ page: 2, kind: "table", number: "1" }), 10)).toEqual({
    page: 2,
    label: { kind: "table", number: "1" },
  });
});

test("a click elsewhere in the page closes the preview", () => {
  expect(parseCite(cite(null), 10)).toBe("close");
});

test("anything malformed, out of range or too long is ignored", () => {
  const bad: unknown[] = [
    null,
    "x",
    3,
    {},
    cite(3),
    cite({}),
    cite({ page: 0 }),
    cite({ page: -1 }),
    cite({ page: 1.5 }),
    cite({ page: "4" }),
    cite({ page: 11 }),
    cite({ page: 4, quote: "x".repeat(301) }),
    cite({ page: 4, quote: "xx" }),
    cite({ page: 4, quote: 5 }),
    cite({ page: 4, kind: "x", number: "1" }),
    cite({ page: 4, kind: "figure", number: "a" }),
    cite({ page: 4, kind: "figure" }),
    cite({ page: 4, kind: "figure", number: "1.2.3" }),
  ];
  for (const data of bad) expect(parseCite(data, 10)).toBeNull();
});

test("without a PDF the bound is large but a page still has to be sensible", () => {
  expect(parseCite(cite({ page: 9999 }), 9999)).toEqual({ page: 9999 });
  expect(parseCite(cite({ page: 10000 }), 9999)).toBeNull();
});

test("no rectangles: the top of the page", () => {
  expect(cropFor(null)).toEqual({ y: 0, h: 0.3 });
  expect(cropFor([])).toEqual({ y: 0, h: 0.3 });
});

test("a passage in the middle gets a margin and a minimum height", () => {
  const { y, h } = cropFor([[0.1, 0.5, 0.8, 0.04]]);
  expect(y).toBeLessThanOrEqual(0.5 - 0.04);
  expect(y + h).toBeGreaterThanOrEqual(0.54 + 0.1);
  expect(h).toBeGreaterThanOrEqual(0.25);
});

test("near the bottom or the top the band stays inside the page", () => {
  const low = cropFor([[0.1, 0.95, 0.8, 0.03]]);
  expect(low.y + low.h).toBeCloseTo(1);
  expect(low.y).toBeGreaterThanOrEqual(0);
  const high = cropFor([[0.1, 0.01, 0.8, 0.03]]);
  expect(high.y).toBe(0);
  expect(high.h).toBeGreaterThanOrEqual(0.25);
});

test("several lines are all inside the band", () => {
  const { y, h } = cropFor([
    [0.1, 0.2, 0.8, 0.03],
    [0.1, 0.4, 0.8, 0.03],
  ]);
  expect(y).toBeLessThanOrEqual(0.2);
  expect(y + h).toBeGreaterThanOrEqual(0.43);
});
