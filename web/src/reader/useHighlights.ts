import { useCallback, useEffect, useState } from "react";
import type { Rect } from "./lib/quote";

export interface Highlight {
  id: number;
  page: number;
  color: string;
  text: string;
  rects: Rect[];
  created_at: string;
}

export type NewHighlight = Pick<Highlight, "page" | "color" | "text" | "rects">;

export interface HighlightsApi {
  list(item: string): Promise<Highlight[]>;
  add(item: string, body: NewHighlight): Promise<Highlight>;
  remove(item: string, id: number): Promise<void>;
}

const url = (item: string) => `/api/items/${encodeURIComponent(item)}/highlights`;

export const httpApi: HighlightsApi = {
  async list(item) {
    const r = await fetch(url(item));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as Highlight[];
  },
  async add(item, body) {
    const r = await fetch(url(item), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as Highlight;
  },
  async remove(item, id) {
    const r = await fetch(`${url(item)}/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
  },
};

const sorted = (list: Highlight[]) => [...list].sort((a, b) => a.page - b.page || a.id - b.id);

export function useHighlights(itemId: string, api: HighlightsApi = httpApi) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .list(itemId)
      .then((rows) => current && setHighlights(sorted(rows)))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [itemId, api]);

  const add = useCallback(
    async (page: number, color: string, text: string, rects: Rect[]) => {
      try {
        const row = await api.add(itemId, { page, color, text, rects });
        setHighlights((h) => sorted([...h, row]));
      } catch {
        setError(true);
      }
    },
    [itemId, api],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await api.remove(itemId, id);
        setHighlights((h) => h.filter((x) => x.id !== id));
      } catch {
        setError(true);
      }
    },
    [itemId, api],
  );

  return { highlights, add, remove, error };
}
