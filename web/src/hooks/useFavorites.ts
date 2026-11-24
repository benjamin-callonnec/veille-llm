import { useCallback, useEffect, useState } from "react";
import { type Item, parseItem } from "../lib/catalogue";

/** The local reader's favorites (#48). The public catalogue has no server: no favorites there. */
export interface FavoritesApi {
  /** [{item_id, item, added_at}], newest first; `item` is the copy taken when it was added. */
  list(): Promise<unknown>;
  add(itemId: string): Promise<void>;
  remove(itemId: string): Promise<void>;
}

const url = (id: string) => `/api/favorites/${encodeURIComponent(id)}`;

async function send(id: string, method: "PUT" | "DELETE") {
  const r = await fetch(url(id), { method });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export const httpFavorites: FavoritesApi = {
  async list() {
    const r = await fetch("/api/favorites");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  add: (id) => send(id, "PUT"),
  remove: (id) => send(id, "DELETE"),
};

interface Saved {
  ids: Set<string>;
  saved: Item[];
}

function parse(raw: unknown): Saved {
  const rows = Array.isArray(raw) ? raw : [];
  const ids = new Set<string>();
  const saved: Item[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { item_id, item } = row as { item_id?: unknown; item?: unknown };
    if (typeof item_id !== "string") continue;
    ids.add(item_id);
    const parsed = parseItem(item);
    if (parsed) saved.push(parsed);
  }
  return { ids, saved };
}

export function useFavorites(api: FavoritesApi | null) {
  const [state, setState] = useState<Saved>({ ids: new Set(), saved: [] });
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      setState(parse(await api.list()));
    } catch {
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = useCallback(
    async (id: string) => {
      if (!api) return;
      const on = !state.ids.has(id);
      const ids = new Set(state.ids);
      if (on) ids.add(id);
      else ids.delete(id);
      setState((s) => ({ ...s, ids })); // the star answers at once, the server follows
      try {
        await (on ? api.add(id) : api.remove(id));
        setError(false);
      } catch {
        setError(true);
      }
      await reload(); // the server's list is the truth, and it brings the saved copies
    },
    [api, state.ids, reload],
  );

  return { ids: state.ids, saved: state.saved, toggle, error };
}
