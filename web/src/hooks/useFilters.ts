import { useCallback, useEffect, useRef, useState } from "react";
import { type Filters, pruneCategories, readHash, writeHash } from "../lib/catalogue";

/** Filters kept in the URL hash: read on load, on back/forward, written on every change. */
export function useFilters(knownCategories: Set<string> | null) {
  const [filters, setFilters] = useState<Filters>(() => readHash(window.location.hash));

  const known = useRef(knownCategories);
  known.current = knownCategories;

  useEffect(() => {
    const onHashChange = () => {
      const next = readHash(window.location.hash);
      setFilters(known.current ? pruneCategories(next, known.current) : next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Once today's categories are known, forget the ones that no longer exist.
  useEffect(() => {
    if (knownCategories) setFilters((f) => pruneCategories(f, knownCategories));
  }, [knownCategories]);

  useEffect(() => {
    const hash = writeHash(filters);
    if (hash !== window.location.hash) {
      window.history.replaceState(
        null,
        "",
        hash || window.location.pathname + window.location.search,
      );
    }
  }, [filters]);

  const toggle = useCallback(
    (key: "categories" | "types", value: string) =>
      setFilters((f) => ({
        ...f,
        [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
      })),
    [],
  );

  return { filters, setFilters, toggle };
}
