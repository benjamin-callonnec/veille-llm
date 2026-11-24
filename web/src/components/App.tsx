import { useEffect, useMemo, useRef } from "react";
import { fetchCatalogue, useCatalogue } from "../hooks/useCatalogue";
import { type FavoritesApi, httpFavorites, useFavorites } from "../hooks/useFavorites";
import { useFilters } from "../hooks/useFilters";
import {
  applyFilters,
  chipCategories,
  countsByCategory,
  type SortKey,
  TYPE_LABELS,
  TYPES,
} from "../lib/catalogue";
import { Card } from "./Card";

const SORT_LABELS: Record<SortKey, string> = { trending: "Trending", date: "Date", score: "Score" };

// Favorites live in the local reader: only the build that has it can keep them.
const READER_FAVORITES = import.meta.env.VITE_READER_URL ? httpFavorites : null;

export function App({
  load = fetchCatalogue,
  favorites: favoritesApi = READER_FAVORITES,
}: {
  load?: () => Promise<unknown>;
  favorites?: FavoritesApi | null;
}) {
  const { catalogue, error } = useCatalogue(load);
  const favorites = useFavorites(favoritesApi);
  const all = useMemo(() => catalogue?.items ?? [], [catalogue]);
  const known = useMemo(
    () => (catalogue ? new Set(all.map((i) => i.category)) : null),
    [catalogue, all],
  );
  const { filters, setFilters, toggle } = useFilters(known);
  const onlyFavorites = favoritesApi !== null && filters.favorites;
  // a favorite gone from the catalogue still shows, from the copy saved with it
  const items = useMemo(() => {
    if (!onlyFavorites) return all;
    const live = all.filter((i) => favorites.ids.has(i.id));
    const present = new Set(live.map((i) => i.id));
    return [...live, ...favorites.saved.filter((i) => !present.has(i.id))];
  }, [all, onlyFavorites, favorites.ids, favorites.saved]);

  const counts = useMemo(() => countsByCategory(items, filters), [items, filters]);
  const shown = useMemo(() => applyFilters(items, filters), [items, filters]);
  const { chips, more } = chipCategories(counts, filters.categories);
  const search = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box, unless you are already typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (e.key === "/" && !typing && !e.altKey && !e.ctrlKey && !e.metaKey && search.current) {
        e.preventDefault();
        search.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chip = (name: string, list: "categories" | "types", label: string, count?: number) => (
    <button
      key={name}
      type="button"
      className="chip"
      aria-pressed={filters[list].includes(name)}
      onClick={() => toggle(list, name)}
    >
      {label}
      {count !== undefined && <span className="count"> {count}</span>}
    </button>
  );

  return (
    <>
      <header className="page-head">
        <h1>LLM watch</h1>
        <p className="muted" aria-live="polite">
          {catalogue
            ? `Updated ${new Date(catalogue.generated_at).toLocaleDateString("en-US")} · ${shown.length} of ${all.length} items`
            : error
              ? ""
              : "Loading…"}
        </p>
      </header>
      {error && <p role="alert">The catalogue could not be loaded. Try again later.</p>}
      {catalogue && (
        <main>
          <div className="controls">
            <input
              ref={search}
              type="search"
              placeholder="Search titles, hooks and summaries"
              aria-label="Search"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
            <label className="sort">
              Sort
              <select
                value={filters.sort}
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as SortKey }))}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="chips">
            <legend>Categories</legend>
            {chips.map((c) => chip(c, "categories", c, counts.get(c) ?? 0))}
            {more.length > 0 && (
              <details className="more">
                <summary>+{more.length} more</summary>
                <fieldset className="chips">
                  <legend>More categories</legend>
                  {more.map((c) => chip(c, "categories", c, counts.get(c) ?? 0))}
                </fieldset>
              </details>
            )}
          </fieldset>
          <fieldset className="chips">
            <legend>Type</legend>
            {TYPES.map((t) => chip(t, "types", TYPE_LABELS[t]))}
          </fieldset>
          {favoritesApi && (
            <fieldset className="chips">
              <legend>Saved</legend>
              <button
                type="button"
                className="chip"
                aria-pressed={filters.favorites}
                onClick={() => setFilters((f) => ({ ...f, favorites: !f.favorites }))}
              >
                Favorites<span className="count"> {favorites.ids.size}</span>
              </button>
            </fieldset>
          )}
          {shown.length === 0 ? (
            <p className="muted">No items match these filters.</p>
          ) : (
            shown.map((item) => (
              <Card
                key={item.id}
                item={item}
                favorite={
                  favoritesApi
                    ? { on: favorites.ids.has(item.id), onToggle: () => favorites.toggle(item.id) }
                    : undefined
                }
              />
            ))
          )}
        </main>
      )}
    </>
  );
}
