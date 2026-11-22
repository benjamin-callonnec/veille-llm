import { expect, test } from "vitest";
import type { TextBox } from "../pdf/source";
import { locateQuote, normalise } from "./locate";

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
