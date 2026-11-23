export type ItemType = "paper" | "news" | "benchmark";
export type SortKey = "trending" | "date" | "score";

export interface Item {
  id: string;
  source: string;
  kind: string;
  title: string;
  url: string;
  authors: string[];
  published: string;
  upvotes: number;
  /** Stars of the repo Hugging Face links to the paper (0 when none, or in older catalogues). */
  github_stars: number;
  score: number;
  type: ItemType;
  category: string;
  hook: string;
  brief: string;
}

export interface Catalogue {
  generated_at: string;
  window_days: number;
  categories: { name: string; count: number }[];
  items: Item[];
}

export interface Filters {
  categories: string[];
  types: string[];
  query: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = { categories: [], types: [], query: "", sort: "trending" };
export const TYPES: ItemType[] = ["paper", "news", "benchmark"];
export const FALLBACK_CATEGORY = "Other";
const SORTS: SortKey[] = ["trending", "date", "score"];

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseItem(raw: unknown): Item | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    !isStr(r.id) ||
    !isStr(r.title) ||
    !isStr(r.url) ||
    !isStr(r.published) ||
    !isStr(r.category) ||
    !isStr(r.hook) ||
    !isNum(r.score) ||
    !TYPES.includes(r.type as ItemType) ||
    Number.isNaN(Date.parse(r.published))
  ) {
    return null;
  }
  return {
    id: r.id,
    source: isStr(r.source) ? r.source : "",
    kind: isStr(r.kind) ? r.kind : "",
    title: r.title,
    url: r.url,
    authors: Array.isArray(r.authors) ? r.authors.filter(isStr) : [],
    published: r.published,
    upvotes: isNum(r.upvotes) ? r.upvotes : 0,
    github_stars: isNum(r.github_stars) ? Math.max(0, r.github_stars) : 0,
    score: Math.min(10, Math.max(0, r.score)),
    type: r.type as ItemType,
    category: r.category,
    hook: r.hook,
    brief: isStr(r.brief) ? r.brief : "",
  };
}

/** Validate the payload; malformed items are dropped rather than breaking the page. */
export function parseCatalogue(raw: unknown): Catalogue {
  if (typeof raw !== "object" || raw === null) throw new Error("catalogue is not an object");
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items)) throw new Error("catalogue has no items list");
  return {
    generated_at: isStr(r.generated_at) ? r.generated_at : "",
    window_days: isNum(r.window_days) ? r.window_days : 0,
    categories: [],
    items: r.items.map(parseItem).filter((i): i is Item => i !== null),
  };
}

/** Only http(s) links are ever rendered as links. */
export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const ARXIV_ID = String.raw`(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)`;
const ARXIV_PATH = new RegExp(`^/(?:abs|pdf)/${ARXIV_ID}(?:\\.pdf)?/?$`);

/** Same rule as the reader server: an https arxiv.org abs/pdf link has a PDF it can fetch. */
export function hasArxivPdf(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "arxiv.org" &&
      !u.port &&
      ARXIV_PATH.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Link to the local reader for an item for an item; null when the reader is not enabled for this build.
 * The reader page lives next to the catalogue page, so the link is relative: it follows whatever
 * address the catalogue is served from (dev server, built front) and never carries a port.
 */
export function readerUrl(itemId: string, enabled: string | undefined): string | null {
  if (!enabled) return null;
  return `reader.html#item=${encodeURIComponent(itemId)}`;
}

function matches(item: Item, f: Filters, ignoreCategory = false): boolean {
  if (!ignoreCategory && f.categories.length && !f.categories.includes(item.category)) return false;
  if (f.types.length && !f.types.includes(item.type)) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.hook, item.brief, item.category].some((t) =>
    t.toLowerCase().includes(q),
  );
}

/**
 * Upvotes plus the 0-10 score (news never have upvotes: the score keeps strong news among trending
 * papers), plus the GitHub stars on a log scale (a 100k-star repo adds 17, not 100k).
 */
const trend = (i: Item) => i.upvotes + i.score + Math.log2(1 + i.github_stars);

export function applyFilters(items: Item[], f: Filters): Item[] {
  const byDate = (a: Item, b: Item) => b.published.localeCompare(a.published);
  const order: Record<SortKey, (a: Item, b: Item) => number> = {
    trending: (a, b) => trend(b) - trend(a) || byDate(a, b),
    date: (a, b) => byDate(a, b) || b.score - a.score,
    score: (a, b) => b.score - a.score || byDate(a, b),
  };
  return items.filter((i) => matches(i, f)).sort(order[f.sort]);
}

/** Per-category counts under the type and search filters, ignoring the category filter. */
export function countsByCategory(items: Item[], f: Filters): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (matches(i, f, true)) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  }
  return counts;
}

function ordered(counts: Map<string, number>): string[] {
  return [...counts.keys()].sort((a, b) => {
    if (a === FALLBACK_CATEGORY) return 1;
    if (b === FALLBACK_CATEGORY) return -1;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
  });
}

export function chipCategories(
  counts: Map<string, number>,
  selected: string[],
  limit = 7,
): { chips: string[]; more: string[] } {
  const all = ordered(counts);
  const chips = all.slice(0, limit);
  for (const s of selected) if (!chips.includes(s)) chips.push(s); // never hide a selection
  return { chips, more: all.filter((c) => !chips.includes(c)) };
}

/** Drop categories that are not in today's catalogue (renamed or gone). */
export function pruneCategories(f: Filters, known: Set<string>): Filters {
  const categories = f.categories.filter((c) => known.has(c));
  return categories.length === f.categories.length ? f : { ...f, categories };
}

export function writeHash(f: Filters): string {
  const p = new URLSearchParams();
  if (f.categories.length) p.set("cat", f.categories.join(","));
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.query) p.set("q", f.query);
  if (f.sort !== "trending") p.set("sort", f.sort);
  const text = p.toString();
  return text ? `#${text}` : "";
}

export function readHash(hash: string): Filters {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const list = (key: string) => (p.get(key) ?? "").split(",").filter(Boolean);
  const sort = p.get("sort") as SortKey;
  return {
    categories: list("cat"),
    types: list("type").filter((t) => TYPES.includes(t as ItemType)),
    query: p.get("q") ?? "",
    sort: SORTS.includes(sort) ? sort : "trending",
  };
}
