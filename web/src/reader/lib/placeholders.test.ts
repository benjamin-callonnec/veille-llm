import { expect, test } from "vitest";
import { nextPlaceholder, placeholders } from "./placeholders";

const TEXT = "Compare [method A] with [method B] on [dataset]";

test("finds the bracketed spots in order", () => {
  expect(placeholders(TEXT).map((r) => TEXT.slice(r.start, r.end))).toEqual([
    "[method A]",
    "[method B]",
    "[dataset]",
  ]);
});

test("ignores empty brackets, nested ones and brackets over several lines", () => {
  expect(placeholders("a [] b [x\ny] c [[z]]")).toEqual([{ start: 16, end: 19 }]);
  expect(placeholders("no placeholder here")).toEqual([]);
});

test("moves forward from the caret or from the selected placeholder", () => {
  expect(nextPlaceholder(TEXT, 0, 0)).toEqual({ start: 8, end: 18 });
  expect(nextPlaceholder(TEXT, 8, 18)).toEqual({ start: 24, end: 34 });
  expect(nextPlaceholder(TEXT, 24, 34)).toEqual({ start: 38, end: 47 });
  expect(nextPlaceholder(TEXT, 38, 47)).toBeNull();
});

test("moves back with the back flag", () => {
  expect(nextPlaceholder(TEXT, 38, 47, true)).toEqual({ start: 24, end: 34 });
  expect(nextPlaceholder(TEXT, 8, 18, true)).toBeNull();
  expect(nextPlaceholder(TEXT, TEXT.length, TEXT.length, true)).toEqual({ start: 38, end: 47 });
});
