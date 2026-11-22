export interface Hit {
  page: number;
  start: number;
  end: number;
  snippet: string;
}

const MAX_HITS = 500;
const CONTEXT = 30;

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

/** Case-insensitive, whitespace-insensitive search over the text of each page. */
export function findAll(pages: { page: number; text: string }[], query: string): Hit[] {
  const q = normalise(query).toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const { page, text } of pages) {
    const clean = normalise(text);
    const lower = clean.toLowerCase();
    let from = lower.indexOf(q);
    while (from !== -1) {
      hits.push({
        page,
        start: from,
        end: from + q.length,
        snippet: clean.slice(Math.max(0, from - CONTEXT), from + q.length + CONTEXT),
      });
      if (hits.length >= MAX_HITS) return hits;
      from = lower.indexOf(q, from + 1);
    }
  }
  return hits;
}
