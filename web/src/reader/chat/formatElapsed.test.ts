import { expect, test } from "vitest";
import { formatElapsed } from "./formatElapsed";

test("minutes and two-digit seconds", () => {
  expect(formatElapsed(0)).toBe("0:00");
  expect(formatElapsed(999)).toBe("0:00");
  expect(formatElapsed(7000)).toBe("0:07");
  expect(formatElapsed(59_999)).toBe("0:59");
  expect(formatElapsed(65_000)).toBe("1:05");
  expect(formatElapsed(600_000)).toBe("10:00");
  expect(formatElapsed(3_725_000)).toBe("62:05");
});

test("nonsense never shows NaN or a minus sign", () => {
  expect(formatElapsed(-5000)).toBe("0:00");
  expect(formatElapsed(Number.NaN)).toBe("0:00");
  expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("0:00");
});
