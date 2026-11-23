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
