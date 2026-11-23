import { expect, test } from "vitest";
import { parseCite, peekScrollTop } from "./peek";

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

test("no passage: the page is shown from its top", () => {
  expect(peekScrollTop(null, 800, 300)).toBe(0);
  expect(peekScrollTop([], 800, 300)).toBe(0);
});

test("the passage lands a third of the way down the visible area, never above the page", () => {
  // the passage is at 50% of an 800px page; the card shows 300px: 400 - 100
  expect(peekScrollTop([[0.1, 0.5, 0.8, 0.04]], 800, 300)).toBe(300);
  // near the top: scrolling would go negative, so 0
  expect(peekScrollTop([[0.1, 0.02, 0.8, 0.04]], 800, 300)).toBe(0);
});

test("with several lines the first one counts", () => {
  expect(
    peekScrollTop(
      [
        [0.1, 0.6, 0.8, 0.03],
        [0.1, 0.5, 0.8, 0.03],
      ],
      800,
      300,
    ),
  ).toBe(300);
});
