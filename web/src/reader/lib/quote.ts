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
  return rects.length ? { text: clean, page, rects } : null;
}

export function toPixelRects(rects: Rect[], width: number, height: number) {
  return rects.map(([x, y, w, h]) => ({
    left: x * width,
    top: y * height,
    width: w * width,
    height: h * height,
  }));
}
