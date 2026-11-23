import { expect, test } from "vitest";
import type { TextBox } from "../pdf/source";
import { locateClosest, locateQuote, normalise, significantWords } from "./locate";

const PAGE = { width: 600, height: 800 };
const box = (text: string, x: number, y: number, width = 100, height = 10): TextBox => ({
  text,
  x,
  y,
  width,
  height,
});

test("normalise keeps only lower-case letters and digits, folding ligatures", () => {
  expect(normalise("Efﬁcient, well-known  X2!")).toBe("efficientwellknownx2");
});

test("a quote inside one box gives that box", () => {
  const boxes = [box("Intro", 60, 100), box("We propose a new method", 60, 200)];
  const rects = locateQuote(boxes, "a new method", PAGE);
  expect(rects).toHaveLength(1);
  [0.1, 0.25, 100 / 600, 10 / 800].forEach((v, i) => {
    expect(rects?.[0]?.[i]).toBeCloseTo(v);
  });
});

test("a quote across two boxes of one line is merged into one rectangle", () => {
  const boxes = [box("We propose a", 60, 200, 100), box("new method here", 162, 200, 100)];
  const rects = locateQuote(boxes, "propose a new method", PAGE);
  expect(rects).toHaveLength(1);
  expect(rects?.[0]?.[0]).toBeCloseTo(0.1);
  expect(rects?.[0]?.[2]).toBeCloseTo(202 / 600);
});

test("a quote across two lines gives one rectangle per line", () => {
  const boxes = [box("We propose a", 60, 200), box("new method here", 60, 214)];
  expect(locateQuote(boxes, "propose a new method", PAGE)).toHaveLength(2);
});

test("spacing, hyphens, case and ligatures do not matter", () => {
  const boxes = [box("state-of-the-art eﬃcient", 60, 100)];
  expect(locateQuote(boxes, "STATE of the art   efficient", PAGE)).toHaveLength(1);
  const split = [box("a train-", 60, 100), box("ing set", 60, 112)];
  expect(locateQuote(split, "training set", PAGE)).toHaveLength(2);
});

test("a quote that is not there, empty or too short gives null", () => {
  const boxes = [box("We propose a new method", 60, 200)];
  expect(locateQuote(boxes, "something else entirely", PAGE)).toBeNull();
  expect(locateQuote(boxes, "", PAGE)).toBeNull();
  expect(locateQuote(boxes, "a new", PAGE)).toBeNull();
  expect(locateQuote([], "a long enough quote", PAGE)).toBeNull();
});

test("repeated text matches its first occurrence", () => {
  const boxes = [
    box("the same words", 60, 100),
    box("filler", 60, 120),
    box("the same words", 60, 300),
  ];
  const rects = locateQuote(boxes, "the same words", PAGE);
  expect(rects).toHaveLength(1);
  expect(rects?.[0]?.[1]).toBeCloseTo(100 / 800);
});

test("2000 boxes are searched quickly", () => {
  const boxes = Array.from({ length: 2000 }, (_, i) => box(`word number ${i}`, 10, (i % 70) * 11));
  const start = performance.now();
  const rects = locateQuote(boxes, "word number 1999", PAGE);
  expect(performance.now() - start).toBeLessThan(200);
  expect(rects).not.toBeNull();
});

test("a page with no size gives null", () => {
  expect(
    locateQuote([box("some text here", 0, 0)], "some text here", { width: 0, height: 0 }),
  ).toBeNull();
});

// --- the closest passage (when there is no exact quote) -----------------------------------

test("significant words drop short and common words, keep numbers and names", () => {
  expect(significantWords("The accuracy of GPT-4 rises by 12% on GSM8K, and it is a gain")).toEqual(
    ["accuracy", "gpt", "rises", "12", "gsm8k", "gain"],
  );
  expect(significantWords("")).toEqual([]);
});

// a page with three paragraphs, each made of lines (boxes) that read top to bottom
const PARAGRAPHS = [
  ["We introduce a retrieval module that ranks", "passages before the reader model sees them."],
  ["On GSM8K the accuracy rises by 12% when the", "reasoning steps are sampled several times."],
  ["Training uses 64 GPUs for two weeks with a", "cosine learning rate schedule and warmup."],
];
const page = () =>
  PARAGRAPHS.flatMap((lines, p) =>
    lines.map((text, l) => box(text, 60, 100 + p * 120 + l * 14, 480, 12)),
  );

test("the closest passage is the paragraph that shares the most words with the slide text", () => {
  const rects = locateClosest(page(), "Accuracy rises 12% on GSM8K with sampled reasoning", PAGE);
  expect(rects).not.toBeNull();
  const tops = (rects ?? []).map((r) => r[1] * PAGE.height);
  // the second paragraph starts at y = 220: its lines, not the first or the third one
  expect(Math.min(...tops)).toBeGreaterThanOrEqual(215);
  expect(Math.max(...tops)).toBeLessThan(250);
});

test("a slide that is about the third paragraph finds the third paragraph", () => {
  const rects = locateClosest(
    page(),
    "Training takes 64 GPUs and a cosine schedule with warmup",
    PAGE,
  );
  const top = Math.min(...(rects ?? []).map((r) => r[1] * PAGE.height));
  expect(top).toBeGreaterThanOrEqual(335);
});

test("nothing close enough: no passage rather than a wrong one", () => {
  expect(
    locateClosest(page(), "Quantum entanglement of photons in a vacuum chamber", PAGE),
  ).toBeNull();
  // two shared words are not a match
  expect(locateClosest(page(), "Several passages about weather and mountains", PAGE)).toBeNull();
});

test("a slide text with too few significant words proves nothing", () => {
  expect(locateClosest(page(), "It is the 12 of them", PAGE)).toBeNull();
  expect(locateClosest(page(), "", PAGE)).toBeNull();
});

test("an empty page, or a page with no size, gives nothing and never throws", () => {
  expect(locateClosest([], "Accuracy rises 12% on GSM8K", PAGE)).toBeNull();
  expect(locateClosest(page(), "Accuracy rises 12% on GSM8K", { width: 0, height: 0 })).toBeNull();
});
