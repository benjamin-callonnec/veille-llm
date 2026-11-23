import { describe, expect, test } from "vitest";
import { placeBox } from "./place";

const VIEW = { width: 1000, height: 800 };
const BOX = { width: 340, height: 48 };

describe("placeBox", () => {
  test("goes just under the anchor", () => {
    expect(placeBox({ x: 300, y: 200 }, BOX, VIEW)).toEqual({ left: 300, top: 208 });
  });
  test("is kept inside the right edge", () => {
    expect(placeBox({ x: 900, y: 200 }, BOX, VIEW).left).toBe(1000 - 340 - 8);
  });
  test("is kept inside the left edge", () => {
    expect(placeBox({ x: -50, y: 200 }, BOX, VIEW).left).toBe(8);
  });
  test("flips above the anchor when there is no room below", () => {
    const placed = placeBox({ x: 300, y: 780 }, BOX, VIEW);
    expect(placed.top).toBe(780 - 48 - 8);
  });
  test("never leaves the top of the screen", () => {
    expect(
      placeBox({ x: 300, y: 10 }, BOX, { width: 1000, height: 40 }).top,
    ).toBeGreaterThanOrEqual(8);
  });
  test("a viewport smaller than the box still gives sane numbers", () => {
    const placed = placeBox({ x: 500, y: 500 }, BOX, { width: 200, height: 30 });
    expect(placed.left).toBe(8);
    expect(placed.top).toBeGreaterThanOrEqual(8);
  });
});
