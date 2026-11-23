import { expect, test } from "vitest";
import { ENTRY_COUNT, FIRST_HINT, idleHint, idleSequence, recoAt, shuffledOrder } from "./hints";
import { type Available, TIPS } from "./tips";

const none: Available = { skills: false, reports: false, dictation: false };
const all: Available = { skills: true, reports: true, dictation: true };

test("the tips are a plain static list: each one says something, none twice", () => {
  expect(TIPS.length).toBeGreaterThanOrEqual(10);
  const texts = TIPS.map((t) => t.text);
  expect(new Set(texts).size).toBe(texts.length);
  for (const text of texts) expect(text.length).toBeGreaterThan(10);
});

test("with nothing to recommend, the composer opens on the invitation, then goes through the tips", () => {
  expect(idleHint(0, none)).toBe(FIRST_HINT);
  expect(FIRST_HINT).toBe("Ask about the paper…");
  const usable = TIPS.filter((t) => !t.needs).map((t) => t.text);
  expect([...Array(usable.length)].map((_, k) => idleHint(k + 1, none))).toEqual(usable);
});

test("the sequence wraps around: the invitation comes back after the last tip", () => {
  const length = 1 + TIPS.length;
  expect(idleHint(length, all)).toBe(FIRST_HINT);
  expect(idleHint(length + 1, all)).toBe(idleHint(1, all));
});

test("a tip about a missing feature is never shown", () => {
  const seen = (have: Available) =>
    new Set(Array.from({ length: 100 }, (_, n) => idleHint(n, have)));
  expect([...seen(none)].some((t) => t.includes("Type / for commands"))).toBe(false);
  expect([...seen(none)].some((t) => t.includes("reports"))).toBe(false);
  expect([...seen(none)].some((t) => t.includes("microphone"))).toBe(false);
  expect([...seen({ ...none, skills: true })].some((t) => t.includes("Type / for commands"))).toBe(
    true,
  );
  expect([...seen({ ...none, reports: true })].some((t) => t.includes("reports"))).toBe(true);
  expect([...seen({ ...none, dictation: true })].some((t) => t.includes("microphone"))).toBe(true);
});

test("every tip can be reached when everything is available", () => {
  const seen = new Set(Array.from({ length: 1 + TIPS.length }, (_, n) => idleHint(n, all)));
  for (const tip of TIPS) expect(seen.has(tip.text)).toBe(true);
});

test("recommendations come one after the other and wrap; none means nothing to say", () => {
  const recos = ["First?", "Second?", "Third?"];
  expect([0, 1, 2, 3, 4].map((n) => recoAt(n, recos))).toEqual([
    "First?",
    "Second?",
    "Third?",
    "First?",
    "Second?",
  ]);
  expect(recoAt(0, [])).toBeNull();
});

// a small seeded generator: the same seed always gives the same numbers
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test("a shuffled order is a permutation of the invitation and the tips, never a loss or a duplicate", () => {
  expect(ENTRY_COUNT).toBe(TIPS.length + 1);
  for (const seed of [1, 2, 3, 99]) {
    const order = shuffledOrder(ENTRY_COUNT, seeded(seed));
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: ENTRY_COUNT }, (_, i) => i),
    );
  }
  expect(shuffledOrder(0)).toEqual([]);
  expect(shuffledOrder(1)).toEqual([0]);
});

test("different draws give different orders, the same draw the same order", () => {
  const a = shuffledOrder(ENTRY_COUNT, seeded(1));
  const b = shuffledOrder(ENTRY_COUNT, seeded(2));
  expect(a).not.toEqual(b);
  expect(shuffledOrder(ENTRY_COUNT, seeded(1))).toEqual(a);
  expect(a).not.toEqual(Array.from({ length: ENTRY_COUNT }, (_, i) => i)); // not the written order
});

test("the invitation is drawn like a tip: it does not always come first", () => {
  const firsts = new Set(
    [1, 2, 3, 4, 5, 6, 7, 8].map(
      (seed) => idleSequence(all, shuffledOrder(ENTRY_COUNT, seeded(seed)))[0],
    ),
  );
  expect(firsts.size).toBeGreaterThan(1);
  expect([...firsts].some((t) => t !== FIRST_HINT)).toBe(true);
});

test("the sequence follows the order it is given", () => {
  const order = Array.from({ length: ENTRY_COUNT }, (_, i) => i).reverse(); // the last tip first
  const sequence = idleSequence(none, order);
  expect(sequence.at(-1)).toBe(FIRST_HINT); // the invitation, last in this order
  expect(idleHint(0, none, order)).toBe(sequence[0]);
  expect(idleHint(1, none, order)).toBe(sequence[1]);
  expect(sequence[0]).not.toBe(FIRST_HINT);
});

test("an order that holds tips about missing features still fills every position of a round", () => {
  const order = shuffledOrder(ENTRY_COUNT, seeded(5));
  const sequence = idleSequence(none, order);
  expect(sequence).toHaveLength(1 + TIPS.filter((t) => !t.needs).length);
  expect(new Set(sequence).size).toBe(sequence.length); // no gap, no repeat in one round
});
