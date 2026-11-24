import { useCallback, useEffect, useRef, useState } from "react";
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
  const ids = useRef(state.ids); // what the user last asked for, read by the next toggle
  ids.current = state.ids;
  // One change at a time, in click order: a slow PUT never lands after the DELETE that follows.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const next = parse(await api.list());
      if (pending.current === 0) setState(next); // never undo a click still on its way
    } catch {
      // keep what we show: the next change or page load tries again
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = useCallback(
    (id: string) => {
      if (!api) return Promise.resolve();
      const on = !ids.current.has(id);
      const next = new Set(ids.current);
      if (on) next.add(id);
      else next.delete(id);
      ids.current = next;
      setState((s) => ({ ...s, ids: next })); // the star answers at once, the server follows
      pending.current += 1;
      queue.current = queue.current.then(async () => {
        try {
          await (on ? api.add(id) : api.remove(id));
        } catch {
          // the reload below shows the server's truth again
        }
        pending.current -= 1;
        await reload(); // the server's list is the truth, and it brings the saved copies
      });
      return queue.current;
    },
    [api, reload],
  );

  return { ids: state.ids, saved: state.saved, toggle };
}
