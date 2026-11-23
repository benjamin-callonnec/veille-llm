import type { Label } from "../chat/events";
import type { Rect } from "../lib/quote";

/** What a click on a citation of a report asks for. */
export interface CiteRef {
  page: number;
  quote?: string;
  label?: Label;
}

export const MIN_QUOTE = 3;
export const MAX_QUOTE = 300;
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

const MARGIN_TOP = 0.04;
const MARGIN_BOTTOM = 0.1;
const MIN_BAND = 0.25;
const TOP_BAND = 0.3;

/** The vertical band of a page to show, as fractions of its height. */
export function cropFor(rects: Rect[] | null): { y: number; h: number } {
  if (!rects || rects.length === 0) return { y: 0, h: TOP_BAND };
  const top = Math.min(...rects.map((r) => r[1])) - MARGIN_TOP;
  const bottom = Math.max(...rects.map((r) => r[1] + r[3])) + MARGIN_BOTTOM;
  const h = Math.min(1, Math.max(MIN_BAND, bottom - top));
  const centre = (top + bottom) / 2;
  const y = Math.min(1 - h, Math.max(0, centre - h / 2));
  return { y, h };
}
