import type { Rect } from "./quote";

/** Scroll position that puts a box a third of the viewport from the top, never above its page. */
export function scrollTargetTop(pageTop: number, rectTop: number, viewportHeight: number): number {
  return Math.max(pageTop, pageTop + rectTop - viewportHeight / 3);
}

/** The highest `y` (0..1) of the rects; 0 when there are none. */
export function firstRectTop(rects: Rect[]): number {
  return rects.length ? Math.min(...rects.map((r) => r[1])) : 0;
}
