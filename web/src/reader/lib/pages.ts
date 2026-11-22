export function pageOffsets(pageHeights: number[], gap: number): number[] {
  const offsets: number[] = [];
  let top = 0;
  for (const h of pageHeights) {
    offsets.push(top);
    top += h + gap;
  }
  return offsets;
}

/** Inclusive 0-based range of pages to render: the viewport plus `overscan` pages each side. */
export function visibleWindow(
  scrollTop: number,
  viewportHeight: number,
  pageHeights: number[],
  gap: number,
  overscan: number,
): { first: number; last: number } {
  const count = pageHeights.length;
  if (count === 0) return { first: 0, last: -1 };
  const offsets = pageOffsets(pageHeights, gap);
  const bottom = scrollTop + viewportHeight;
  let first = 0;
  let last = count - 1;
  for (let i = 0; i < count; i++) {
    if ((offsets[i] ?? 0) + (pageHeights[i] ?? 0) > scrollTop) {
      first = i;
      break;
    }
    first = count - 1;
  }
  for (let i = first; i < count; i++) {
    if ((offsets[i] ?? 0) >= bottom) {
      last = Math.max(first, i - 1);
      break;
    }
  }
  return { first: Math.max(0, first - overscan), last: Math.min(count - 1, last + overscan) };
}
