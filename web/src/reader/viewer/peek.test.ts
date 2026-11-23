import { expect, test } from "vitest";
import { parseCite, peekScrollLeft, peekScrollTop } from "./peek";

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

test("the text around a citation is kept to find the closest passage, trimmed and capped", () => {
  const context = "Accuracy rises 12% on GSM8K with sampled reasoning";
  expect(parseCite(cite({ page: 4, context }), 10)).toEqual({ page: 4, context });
  expect(parseCite(cite({ page: 4, context: `  ${context}  ` }), 10)?.valueOf()).toEqual({
    page: 4,
    context,
  });
  const long = parseCite(cite({ page: 4, context: "word ".repeat(200) }), 10);
  expect(
    typeof long === "object" && long !== null && "context" in long ? long.context?.length : 0,
  ).toBeLessThanOrEqual(400);
  // too short to mean anything: dropped, the citation itself stays
  expect(parseCite(cite({ page: 4, context: "short" }), 10)).toEqual({ page: 4 });
  // not a string: the whole message is refused
  expect(parseCite(cite({ page: 4, context: 5 }), 10)).toBeNull();
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

test("horizontally: nothing to scroll at 100%, the passage near the left edge when zoomed", () => {
  expect(peekScrollLeft(null, 1200, 600)).toBe(0);
  // a passage starting at 50% of a 1200px sheet, 600px visible: 600 - 60
  expect(peekScrollLeft([[0.5, 0.2, 0.3, 0.02]], 1200, 600)).toBe(540);
  expect(peekScrollLeft([[0.02, 0.2, 0.3, 0.02]], 1200, 600)).toBe(0);
  // the sheet is as narrow as the view: never scroll
  expect(peekScrollLeft([[0.5, 0.2, 0.3, 0.02]], 600, 600)).toBe(0);
});
