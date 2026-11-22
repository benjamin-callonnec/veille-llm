export const MAX_CANVAS_PIXELS = 16_000_000;

/** The device pixel ratio to use so that a canvas never exceeds the pixel cap (browser limits). */
export function canvasRatio(
  width: number,
  height: number,
  ratio: number,
  max = MAX_CANVAS_PIXELS,
): number {
  const pixels = width * ratio * (height * ratio);
  if (pixels <= max) return ratio;
  return Math.max(0.05, Math.sqrt(max / (width * height)) * 0.999);
}
