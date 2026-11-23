const MARGIN = 8;
const GAP = 8;

interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}

/** Where to put a floating box next to a point: under it, kept on screen, above if no room below. */
export function placeBox(anchor: Point, box: Size, view: Size): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(anchor.x, view.width - box.width - MARGIN));
  let top = anchor.y + GAP;
  if (top + box.height > view.height - MARGIN) top = anchor.y - box.height - GAP;
  return { left, top: Math.max(MARGIN, top) };
}
