import { useEffect, useState } from "react";
import { type Catalogue, parseCatalogue } from "../lib/catalogue";

export const CATALOGUE_URL: string = import.meta.env.VITE_CATALOGUE_URL ?? "catalogue.json";

export async function fetchCatalogue(): Promise<unknown> {
  const response = await fetch(CATALOGUE_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Load the catalogue once per loader; a response from an older loader is ignored. */
export function useCatalogue(load: () => Promise<unknown>) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    setError(false);
    load()
      .then((raw) => current && setCatalogue(parseCatalogue(raw)))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [load]);

  return { catalogue, error };
}
