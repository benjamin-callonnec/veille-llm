import { useEffect, useMemo, useState } from "react";
import { Card } from "./Card";
import {
  applyFilters,
  chipCategories,
  countsByCategory,
  DEFAULT_FILTERS,
  parseCatalogue,
  readHash,
  TYPES,
  writeHash,
  type Catalogue,
  type Filters,
  type SortKey,
} from "./catalogue";

export const CATALOGUE_URL: string = import.meta.env.VITE_CATALOGUE_URL ?? "catalogue.json";

async function fetchCatalogue(): Promise<unknown> {
  const response = await fetch(CATALOGUE_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const SORT_LABELS: Record<SortKey, string> = { trending: "Trending", date: "Date", score: "Score" };
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function App({ load = fetchCatalogue }: { load?: () => Promise<unknown> }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => readHash(window.location.hash));

  useEffect(() => {
    load()
      .then((raw) => setCatalogue(parseCatalogue(raw)))
      .catch(() => setError(true));
  }, [load]);

  useEffect(() => {
    const hash = writeHash(filters);
    if (hash !== window.location.hash) {
      window.history.replaceState(null, "", hash || window.location.pathname + window.location.search);
    }
  }, [filters]);

  const items = catalogue?.items ?? [];
  const counts = useMemo(() => countsByCategory(items, filters), [items, filters]);
  // A category that no longer exists must not silently empty the list.
  const known = useMemo(() => new Set(items.map((i) => i.category)), [items]);
  const effective = useMemo<Filters>(
    () => ({ ...filters, categories: filters.categories.filter((c) => known.has(c) || !catalogue) }),
    [filters, known, catalogue],
  );
  const shown = useMemo(() => applyFilters(items, effective), [items, effective]);
  const { chips, more } = chipCategories(counts, effective.categories);

  const toggle = (key: "categories" | "types", value: string) =>
    setFilters((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));

  const chip = (name: string, list: "categories" | "types", label: string, count?: number) => (
    <button
      key={name}
      type="button"
      className="chip"
      aria-pressed={effective[list].includes(name)}
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
        <p className="muted">
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
