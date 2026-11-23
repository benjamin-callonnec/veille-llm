import { expect, test } from "vitest";
import { EXAMPLES, FIRST_HINT, hintAt, TIP_EVERY, TIPS } from "./hints";

const none = { skills: false, reports: false };
const all = { skills: true, reports: true };

test("the first hint is the plain invitation, so the composer always opens the same way", () => {
  expect(hintAt(0, none)).toBe(FIRST_HINT);
  expect(FIRST_HINT).toBe("Ask about the paper…");
  expect(EXAMPLES[0]).toBe(FIRST_HINT);
});

test("every fourth hint is a tip, the others are examples, and it wraps around", () => {
  const seq = Array.from({ length: 4 * TIP_EVERY * 2 }, (_, n) => hintAt(n, all));
  const tipTexts = new Set(TIPS.map((t) => t.text));
  seq.forEach((text, n) => {
    const isTip = (n + 1) % TIP_EVERY === 0;
    expect(tipTexts.has(text)).toBe(isTip);
  });
  expect(hintAt(1000, all)).toBe(hintAt(1000, all)); // deterministic
});

test("tips come one after the other, each of them shown before any comes back", () => {
  const tips = Array.from({ length: TIPS.length }, (_, k) =>
    hintAt(k * TIP_EVERY + TIP_EVERY - 1, all),
  );
  expect(new Set(tips).size).toBe(TIPS.length);
});

test("a tip about a missing feature is never shown", () => {
  const seen = new Set(Array.from({ length: 200 }, (_, n) => hintAt(n, none)));
  expect([...seen].some((t) => t.includes("Type /"))).toBe(false);
  expect([...seen].some((t) => t.includes("reports"))).toBe(false);
  const withSkills = new Set(
    Array.from({ length: 200 }, (_, n) => hintAt(n, { skills: true, reports: false })),
  );
  expect([...withSkills].some((t) => t.includes("Type / for commands"))).toBe(true);
  expect([...withSkills].some((t) => t.includes("reports"))).toBe(false);
});

test("a hint is never empty, whatever the position", () => {
  for (const n of [0, 1, 3, 7, 99, 12345]) expect(hintAt(n, none).length).toBeGreaterThan(5);
});
