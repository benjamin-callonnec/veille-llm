import type { TextBox } from "../pdf/source";
import { mergeRects, type Rect } from "./quote";

/** Fewer letters and digits than this prove nothing (same threshold as the server). */
const MIN_CHARS = 8;
const ALNUM = /[\p{L}\p{N}]/u;

/** Only the letters and digits, in lower case: layout, hyphens and ligatures never matter. */
export function normalise(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKC").toLowerCase()) if (ALNUM.test(ch)) out += ch;
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Where a quote sits on a page: the normalised rectangles of the text boxes the first match
 * overlaps (one per line), or null when the quote is too short or not on the page.
 */
export function locateQuote(
  boxes: TextBox[],
  quote: string,
  page: { width: number; height: number },
): Rect[] | null {
  const needle = normalise(quote);
  if (needle.length < MIN_CHARS || page.width <= 0 || page.height <= 0) return null;
  let flat = "";
  const owner: number[] = []; // for each normalised character, the index of its box
  boxes.forEach((b, i) => {
    const n = normalise(b.text);
    flat += n;
    for (let k = 0; k < n.length; k++) owner.push(i);
  });
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const hit = new Set(owner.slice(at, at + needle.length));
  const rects: Rect[] = [];
  for (const i of hit) {
    const b = boxes[i];
    if (!b) continue;
    const x = clamp01(b.x / page.width);
    const y = clamp01(b.y / page.height);
    const w = clamp01((b.x + b.width) / page.width) - x;
    const h = clamp01((b.y + b.height) / page.height) - y;
    if (w > 0 && h > 0) rects.push([x, y, w, h]);
  }
  const merged = mergeRects(rects);
  return merged.length ? merged : null;
}

// --- the closest passage -------------------------------------------------------------------

const STOP = new Set(
  (
    "the and for are but not you all can had her was one our out with that this from have been were " +
    "they will would there their what about which when your said each them then into than also such " +
    "only over more most some these those other after before between both through during while where " +
    "being does done very just like make made many much should could using used use based paper shows " +
    "show here how why who its has did get got any may might must per via within without"
  ).split(" "),
);
const MIN_MATCHED = 3; // fewer shared words prove nothing
const MIN_SCORE = 0.45;
const WINDOW_CHARS = 160; // a window of consecutive text boxes: about a paragraph
const MAX_CONTEXT_WORDS = 14;

/** The words of a text that say something: no stop words, no tiny words; numbers of two digits or more. */
export function significantWords(text: string): string[] {
  const seen = new Set<string>();
  for (const w of text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []) {
    const digits = /^\d+$/.test(w);
    if (STOP.has(w) || (digits ? w.length < 2 : w.length < 3)) continue;
    seen.add(w);
  }
  return [...seen];
}

/**
 * The passage of a page that looks most like a text (the slide text around a citation) when
 * there is no exact quote: the lines from the first to the last one that share a word with it, in
 * the best group of consecutive text boxes. Null when it is not close enough: never a wrong passage.
 */
export function locateClosest(
  boxes: TextBox[],
  context: string,
  page: { width: number; height: number },
): Rect[] | null {
  const wanted = significantWords(context).slice(0, MAX_CONTEXT_WORDS);
  if (wanted.length < MIN_MATCHED || boxes.length === 0 || page.width <= 0 || page.height <= 0) {
    return null;
  }
  const words = boxes.map((b) => new Set(significantWords(b.text)));
  // a word found in few boxes says more than one found everywhere
  const df = new Map<string, number>();
  for (const w of wanted) df.set(w, words.filter((s) => s.has(w)).length);
  const weight = (w: string) => 1 / (1 + (df.get(w) ?? 0));
  const total = wanted.reduce((sum, w) => sum + weight(w), 0);

  let best: { score: number; first: number; last: number } | null = null;
  for (let start = 0; start < boxes.length; start++) {
    const found = new Set<string>();
    let first = -1;
    let last = -1;
    let chars = 0;
    for (let i = start; i < boxes.length && chars < WINDOW_CHARS; i++) {
      chars += boxes[i]?.text.length ?? 0;
      const hit = wanted.filter((w) => words[i]?.has(w));
      if (hit.length === 0) continue;
      for (const w of hit) found.add(w);
      if (first < 0) first = i;
      last = i;
    }
    if (found.size < MIN_MATCHED) continue;
    const score = [...found].reduce((sum, w) => sum + weight(w), 0) / total;
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { score, first, last };
  }
  if (!best) return null;
  const rects: Rect[] = [];
  for (const b of boxes.slice(best.first, best.last + 1)) {
    const x = clamp01(b.x / page.width);
    const y = clamp01(b.y / page.height);
    const w = clamp01((b.x + b.width) / page.width) - x;
    const h = clamp01((b.y + b.height) / page.height) - y;
    if (w > 0 && h > 0) rects.push([x, y, w, h]);
  }
  const merged = mergeRects(rects);
  return merged.length ? merged : null;
}
