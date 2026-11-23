import type { Label } from "../chat/events";
import { firstRectTop, scrollTargetTop } from "../lib/goto";
import type { Rect } from "../lib/quote";

/** What a click on a citation of a report asks for. */
export interface CiteRef {
  page: number;
  quote?: string;
  label?: Label;
  /** The slide text around the citation: used to find the closest passage without an exact quote. */
  context?: string;
}

export const MIN_QUOTE = 3;
export const MAX_QUOTE = 300;
export const MIN_CONTEXT = 12;
export const MAX_CONTEXT = 400;
const NUMBER = /^\d+(\.\d+)?$/;

/**
 * The message of a report page is untrusted: keep a citation only if every field is sane.
 * `"close"` is a click elsewhere in the page; null is anything else.
 */
export function parseCite(data: unknown, maxPage: number): CiteRef | "close" | null {
  if (typeof data !== "object" || data === null || !("veilleCite" in data)) return null;
  const raw = (data as { veilleCite: unknown }).veilleCite;
  if (raw === null) return "close";
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const page = r.page;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > maxPage) {
    return null;
  }
  const out: CiteRef = { page };
  if (r.quote !== undefined) {
    const q = r.quote;
    if (typeof q !== "string" || q.length < MIN_QUOTE || q.length > MAX_QUOTE) return null;
    out.quote = q;
  }
  if (r.context !== undefined) {
    if (typeof r.context !== "string") return null;
    const context = r.context.trim().slice(0, MAX_CONTEXT);
    if (context.length >= MIN_CONTEXT) out.context = context;
  }
  if (r.kind !== undefined || r.number !== undefined) {
    if (
      (r.kind !== "figure" && r.kind !== "table") ||
      typeof r.number !== "string" ||
      !NUMBER.test(r.number)
    ) {
      return null;
    }
    out.label = { kind: r.kind, number: r.number };
  }
  return out;
}

/**
 * Where to scroll the page of the preview so the passage is a third of the way down the visible
 * area (never above the page); 0 when nothing was located.
 */
export function peekScrollTop(
  rects: Rect[] | null,
  sheetHeight: number,
  viewportHeight: number,
): number {
  if (!rects || rects.length === 0) return 0;
  return scrollTargetTop(0, firstRectTop(rects) * sheetHeight, viewportHeight);
}

/**
 * Where to scroll sideways when the page is zoomed wider than the card: the passage starts near the
 * left edge of the visible area; 0 when nothing was located or the whole page fits.
 */
export function peekScrollLeft(
  rects: Rect[] | null,
  sheetWidth: number,
  viewportWidth: number,
): number {
  if (!rects || rects.length === 0 || sheetWidth <= viewportWidth) return 0;
  const left = Math.min(...rects.map((r) => r[0])) * sheetWidth;
  return Math.max(0, left - viewportWidth * 0.1);
}
