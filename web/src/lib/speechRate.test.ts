import { expect, test } from "vitest";
import { loadSpeed, RATES, saveSpeed } from "./speechRate";

function memory(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
}

test("the speed is normal until chosen, then remembered", () => {
  const store = memory();
  expect(loadSpeed(store)).toBe("normal");
  saveSpeed(store, "slow");
  expect(loadSpeed(store)).toBe("slow");
});

test("an unknown or unreadable value falls back to normal", () => {
  expect(loadSpeed(memory("turbo"))).toBe("normal");
  expect(loadSpeed(null)).toBe("normal");
  expect(
    loadSpeed({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
  ).toBe("normal");
});

test("slow is below the voice's pace and fast above it", () => {
  expect(RATES.slow).toBeLessThan(1);
  expect(RATES.normal).toBe(1);
  expect(RATES.fast).toBeGreaterThan(1);
});
