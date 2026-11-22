import { expect, test } from "vitest";
import { canvasRatio, MAX_CANVAS_PIXELS } from "./canvas";

test("keeps the device ratio when the canvas is small enough", () => {
  expect(canvasRatio(612, 792, 2)).toBe(2);
});

test("lowers the ratio so a canvas never exceeds the pixel cap", () => {
  const ratio = canvasRatio(612 * 3, 792 * 3, 2);
  expect(ratio).toBeLessThan(2);
  expect(Math.floor(612 * 3 * ratio) * Math.floor(792 * 3 * ratio)).toBeLessThanOrEqual(
    MAX_CANVAS_PIXELS,
  );
});

test("an enormous page still gets a positive ratio", () => {
  expect(canvasRatio(50_000, 50_000, 2)).toBeGreaterThan(0);
});
