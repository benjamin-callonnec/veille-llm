import { expect, test } from "vitest";
import { firstRectTop, scrollTargetTop } from "./goto";

test("the box lands a third of the viewport from the top", () => {
  expect(scrollTargetTop(1000, 600, 900)).toBe(1300);
});

test("a box near the top of its page never scrolls above the page", () => {
  expect(scrollTargetTop(1000, 100, 900)).toBe(1000);
});

test("the first rect is the highest one", () => {
  expect(
    firstRectTop([
      [0.1, 0.5, 0.2, 0.02],
      [0.1, 0.3, 0.2, 0.02],
    ]),
  ).toBe(0.3);
});

test("no rect means the top of the page", () => {
  expect(firstRectTop([])).toBe(0);
});
