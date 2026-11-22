/** A rectangle as [x, y, width, height], each in 0..1 of the page (zoom independent). */
export type Rect = [number, number, number, number];

export interface Quote {
  text: string;
  page: number;
  rects: Rect[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Turn a text selection on one page into a quote with normalised rectangles. */
export function toQuote(
  page: number,
  text: string,
  clientRects: Box[],
  pageBox: Box,
): Quote | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || pageBox.width <= 0 || pageBox.height <= 0) return null;
  const rects: Rect[] = [];
  for (const r of clientRects) {
    const left = clamp01((r.x - pageBox.x) / pageBox.width);
    const top = clamp01((r.y - pageBox.y) / pageBox.height);
    const right = clamp01((r.x + r.width - pageBox.x) / pageBox.width);
    const bottom = clamp01((r.y + r.height - pageBox.y) / pageBox.height);
    const width = right - left;
    const height = bottom - top;
    if (width > 0 && height > 0) rects.push([left, top, width, height]);
  }
  const merged = mergeRects(rects);
  return merged.length ? { text: clean, page, rects: merged } : null;
}

const MAX_RECTS = 200;

const right = (r: Rect) => r[0] + r[2];
const bottom = (r: Rect) => r[1] + r[3];
const contains = (a: Rect, b: Rect) =>
  a[0] <= b[0] + 1e-9 &&
  a[1] <= b[1] + 1e-9 &&
  right(a) + 1e-9 >= right(b) &&
  bottom(a) + 1e-9 >= bottom(b);

/** One rectangle per line: drop contained pieces, join pieces of the same line, cap the count. */
function mergeRects(rects: Rect[]): Rect[] {
  const kept = rects.filter(
    (r, i) => !rects.some((o, j) => j !== i && contains(o, r) && (!contains(r, o) || j < i)),
  );
  const sorted = [...kept].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(r[1] - last[1]) < Math.max(r[3], last[3]) / 2;
    if (last && sameLine && r[0] <= right(last) + 0.01) {
      const x = Math.min(last[0], r[0]);
      const y = Math.min(last[1], r[1]);
      out[out.length - 1] = [
        x,
        y,
        Math.max(right(last), right(r)) - x,
        Math.max(bottom(last), bottom(r)) - y,
      ];
    } else out.push(r);
  }
  return out.slice(0, MAX_RECTS);
}

export function toPixelRects(rects: Rect[], width: number, height: number) {
  return rects.map(([x, y, w, h]) => ({
    left: x * width,
    top: y * height,
    width: w * width,
    height: h * height,
  }));
}
