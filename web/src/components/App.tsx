import { useMemo } from "react";
import { useCatalogue, fetchCatalogue } from "../hooks/useCatalogue";
import { useFilters } from "../hooks/useFilters";
import { Card } from "./Card";
import {
  applyFilters,
  chipCategories,
  countsByCategory,
  TYPES,
  type SortKey,
} from "../lib/catalogue";

const SORT_LABELS: Record<SortKey, string> = { trending: "Trending", date: "Date", score: "Score" };
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function App({ load = fetchCatalogue }: { load?: () => Promise<unknown> }) {
  const { catalogue, error } = useCatalogue(load);
  const items = useMemo(() => catalogue?.items ?? [], [catalogue]);
  const known = useMemo(() => (catalogue ? new Set(items.map((i) => i.category)) : null), [catalogue, items]);
  const { filters, setFilters, toggle } = useFilters(known);

  const counts = useMemo(() => countsByCategory(items, filters), [items, filters]);
  const shown = useMemo(() => applyFilters(items, filters), [items, filters]);
  const { chips, more } = chipCategories(counts, filters.categories);

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
      <header>
        <h1>LLM watch</h1>
        <p className="muted" aria-live="polite">
          {catalogue
            ? `Updated ${new Date(catalogue.generated_at).toLocaleDateString("en-US")} · ${shown.length} of ${items.length} items`
            : error ? "" : "Loading…"}
        </p>
      </header>
      {error && <p role="alert">The catalogue could not be loaded. Try again later.</p>}
      {catalogue && (
        <main>
          <div className="controls">
            <input
              type="search"
              role="searchbox"
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
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="chips" role="group" aria-label="Categories">
            {chips.map((c) => chip(c, "categories", c, counts.get(c) ?? 0))}
            {more.length > 0 && (
              <details className="more">
                <summary>+{more.length} more</summary>
                <div className="chips" role="group" aria-label="More categories">
                  {more.map((c) => chip(c, "categories", c, counts.get(c) ?? 0))}
                </div>
              </details>
            )}
          </div>
          <div className="chips" role="group" aria-label="Type">
            {TYPES.map((t) => chip(t, "types", capitalise(t)))}
          </div>
          {shown.length === 0 ? (
            <p className="muted">No items match these filters.</p>
          ) : (
            shown.map((item) => <Card key={item.id} item={item} />)
          )}
        </main>
      )}
    </>
  );
}
