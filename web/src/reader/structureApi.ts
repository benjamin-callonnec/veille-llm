import type { Label } from "./chat/events";
import type { Rect } from "./lib/quote";

/** The caption of a figure or a table, as the server found it in the PDF. */
export interface Caption {
  kind: "figure" | "table";
  number: string;
  page: number;
  rect: Rect;
}

/** The captions of a paper; none when the structure is not available (never throws). */
export async function fetchCaptions(item: string): Promise<Caption[]> {
  try {
    const r = await fetch(`/api/items/${encodeURIComponent(item)}/structure`);
    if (!r.ok) return [];
    const body = (await r.json()) as { captions?: Caption[] };
    return Array.isArray(body.captions) ? body.captions : [];
  } catch {
    return [];
  }
}

/** The caption a citation names: on the cited page first, else wherever the paper has it. */
export function findCaption(captions: Caption[], label: Label, page: number): Caption | undefined {
  const named = captions.filter((c) => c.kind === label.kind && c.number === label.number);
  return named.find((c) => c.page === page) ?? named[0];
}
