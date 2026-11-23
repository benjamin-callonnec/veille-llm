import { expect, test } from "vitest";
import { sentencesFrom, spokenText, stableSpokenText } from "./spoken";

test("citations, markdown and code are not spoken", () => {
  const md = [
    "# Title",
    "",
    'The **model** reads *text* [p.3 "exact quote here"] and `code()` runs [p.4].',
    "",
    "```py",
    "print(1)",
    "```",
    "- first point",
    "- see [the paper](https://x.org) now",
    "![fig](https://x.org/a.png)",
  ].join("\n");
  const out = spokenText(md);
  expect(out).not.toMatch(/[#*`[\]|]|p\.3|print|https/);
  expect(out).toContain("The model reads text and code() runs.");
  expect(out).toContain("first point");
  expect(out).toContain("see the paper now");
});

test("the quiz marker and an unfinished citation or fence are dropped", () => {
  expect(spokenText('Done. [p.3 "half')).toBe("Done.");
  expect(spokenText("Look:\n```py\nx = 1")).toBe("Look:");
  expect(spokenText("Answer.\n[[quiz: attention]]")).toBe("Answer.");
});

test("table pipes and math delimiters go", () => {
  expect(spokenText("| a | b |\n|---|---|\n| 1 | 2 |")).not.toMatch(/\||---/);
  expect(spokenText("Then $x^2$ holds")).toBe("Then x^2 holds");
});

test("sentences are cut when complete, the tail waits unless final", () => {
  const text = "One sentence. Two here! And a third without end";
  const a = sentencesFrom(text, 0, false);
  expect(a.sentences).toEqual(["One sentence.", "Two here!"]);
  const b = sentencesFrom(text, a.next, false);
  expect(b.sentences).toEqual([]);
  const c = sentencesFrom(text, a.next, true);
  expect(c.sentences).toEqual(["And a third without end"]);
  expect(c.next).toBe(text.length);
});

test("decimals and a trailing period that may continue wait", () => {
  expect(sentencesFrom("Gain of 3.5 points. Next", 0, false).sentences).toEqual([
    "Gain of 3.5 points.",
  ]);
  expect(sentencesFrom("It is 3.", 0, false).sentences).toEqual([]);
});

test("a new line ends a sentence (list items)", () => {
  expect(sentencesFrom("first point\nsecond point\n", 0, false).sentences).toEqual([
    "first point",
    "second point",
  ]);
});

test("a very long run without a stop is cut at a space", () => {
  const long = `${"word ".repeat(100)}end`;
  const { sentences } = sentencesFrom(long, 0, false);
  expect(sentences.length).toBeGreaterThan(0);
  for (const s of sentences) expect(s.length).toBeLessThanOrEqual(300);
});

/** Feeds `raw` a few characters at a time, as a stream, the way the reader does. */
function streamed(raw: string, step = 1): string[] {
  const said: string[] = [];
  let cursor = 0;
  for (let end = step; end <= raw.length + step; end += step) {
    const final = end >= raw.length;
    const text = stableSpokenText(raw.slice(0, end), final);
    const { sentences, next } = sentencesFrom(text, cursor, final);
    cursor = next;
    said.push(...sentences);
  }
  return said;
}

test("a link that closes late does not repeat or skip sentences", () => {
  const raw = "First one. Look at [see fig. 3](http://x) now. Last one.";
  const once = sentencesFrom(spokenText(raw), 0, true).sentences;
  expect(once[0]).toBe("First one.");
  for (const step of [1, 3, 7]) expect(streamed(raw, step)).toEqual(once);
});

test("inline math that closes late does not repeat or skip sentences", () => {
  const raw = "Take $a. b$ here. Then stop.";
  const once = sentencesFrom(spokenText(raw), 0, true).sentences;
  for (const step of [1, 2, 5]) expect(streamed(raw, step)).toEqual(once);
});

test("streaming and one shot say the same thing for mixed markdown", () => {
  const raw = "# Title\n\nSome `code. here` and ![img](u.png) text. A [link](http://y).\n\nEnd.";
  const once = sentencesFrom(spokenText(raw), 0, true).sentences;
  for (const step of [1, 4]) expect(streamed(raw, step)).toEqual(once);
});
