import { describe, expect, test } from "vitest";
import {
  applyFilters,
  chipCategories,
  countsByCategory,
  DEFAULT_FILTERS,
  type Item,
  parseCatalogue,
  readHash,
  safeUrl,
  writeHash,
} from "./catalogue";

const item = (over: Partial<Item>): Item => ({
  id: "a",
  source: "arxiv",
  kind: "paper",
  title: "A title",
  url: "https://example.com/a",
  authors: [],
  published: "2026-11-20T00:00:00Z",
  upvotes: 0,
  score: 5,
  type: "paper",
  category: "Agents",
  hook: "Hook.",
  brief: "Brief.",
  ...over,
});

describe("parseCatalogue", () => {
  test("keeps well-formed items and defaults a missing brief to empty", () => {
    const { brief: _drop, ...old } = item({ id: "old" });
    const cat = parseCatalogue({
      generated_at: "2026-11-22T00:00:00Z",
      window_days: 30,
      categories: [{ name: "Agents", count: 1 }],
      items: [old],
    });
    expect(cat.items).toHaveLength(1);
    expect(cat.items[0]?.brief).toBe("");
  });

  test("drops malformed items instead of failing the whole page", () => {
    const cat = parseCatalogue({
      generated_at: "x",
      window_days: 7,
      categories: [],
      items: [item({}), { id: 3 }, null, "str", { ...item({ id: "b" }), score: "high" }],
    });
    expect(cat.items.map((i) => i.id)).toEqual(["a"]);
  });

  test("drops items with an unparsable date and clamps the score to 0-10", () => {
    const cat = parseCatalogue({
      generated_at: "2026-11-22T00:00:00Z",
      window_days: 30,
      categories: [],
      items: [
        item({ id: "bad", published: "not a date" }),
        item({ id: "big", score: 1e9 }),
        item({ id: "neg", score: -4 }),
      ],
    });
    expect(cat.items.map((i) => [i.id, i.score])).toEqual([
      ["big", 10],
      ["neg", 0],
    ]);
  });

  test("rejects a payload that is not a catalogue", () => {
    expect(() => parseCatalogue(null)).toThrow();
    expect(() => parseCatalogue({ items: "nope" })).toThrow();
  });
});

describe("safeUrl", () => {
  test("allows only http and https", () => {
    expect(safeUrl("https://arxiv.org/abs/1")).toBe("https://arxiv.org/abs/1");
    expect(safeUrl("http://e.com")).toBe("http://e.com/");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});

describe("applyFilters", () => {
  const items = [
    item({
      id: "1",
      category: "Agents",
      type: "paper",
      score: 9,
      upvotes: 1,
      published: "2026-11-18T00:00:00Z",
      title: "Alpha agents",
    }),
    item({
      id: "2",
      category: "Security",
      type: "news",
      score: 4,
      upvotes: 50,
      published: "2026-11-21T00:00:00Z",
      title: "Beta",
    }),
    item({
      id: "3",
      category: "Other",
      type: "benchmark",
      score: 7,
      upvotes: 5,
      published: "2026-11-20T00:00:00Z",
      title: "Gamma",
      hook: "About robots",
    }),
  ];
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) =>
    applyFilters(items, { ...DEFAULT_FILTERS, ...f }).map((i) => i.id);

  test("no filter keeps everything, trending first (upvotes plus score)", () => {
    expect(ids({})).toEqual(["2", "3", "1"]);
  });
  test("trending does not bury news, which never have upvotes", () => {
    const mixed = [
      item({ id: "p", type: "paper", upvotes: 2, score: 3 }),
      item({ id: "n", type: "news", upvotes: 0, score: 9 }),
    ];
    expect(applyFilters(mixed, DEFAULT_FILTERS).map((i) => i.id)).toEqual(["n", "p"]);
  });
  test("sorts by date and by score", () => {
    expect(ids({ sort: "date" })).toEqual(["2", "3", "1"]);
    expect(ids({ sort: "score" })).toEqual(["1", "3", "2"]);
  });
  test("several categories are a union", () => {
    expect(ids({ categories: ["Agents", "Security"], sort: "date" })).toEqual(["2", "1"]);
  });
  test("types are a union and combine with categories (intersection)", () => {
    expect(ids({ types: ["paper", "news"], sort: "date" })).toEqual(["2", "1"]);
    expect(ids({ types: ["paper"], categories: ["Security"] })).toEqual([]);
  });
  test("search matches title, hook, brief and category, case-insensitively", () => {
    expect(ids({ query: "ALPHA" })).toEqual(["1"]);
    expect(ids({ query: "robots" })).toEqual(["3"]);
    expect(ids({ query: "secur" })).toEqual(["2"]);
  });
  test("does not mutate its input", () => {
    const copy = items.map((i) => i.id);
    applyFilters(items, { ...DEFAULT_FILTERS, sort: "score" });
    expect(items.map((i) => i.id)).toEqual(copy);
  });
});

describe("countsByCategory", () => {
  const items = [
    item({ id: "1", category: "Agents", type: "paper" }),
    item({ id: "2", category: "Agents", type: "news" }),
    item({ id: "3", category: "Security", type: "news" }),
  ];
  test("counts follow the type and search filters but not the category filter", () => {
    const counts = countsByCategory(items, {
      ...DEFAULT_FILTERS,
      types: ["news"],
      categories: ["Security"],
    });
    expect(Object.fromEntries(counts)).toEqual({ Agents: 1, Security: 1 });
  });
});

describe("chipCategories", () => {
  const counts = new Map([
    ["Other", 50],
    ["A", 10],
    ["B", 30],
    ["C", 20],
    ["D", 5],
  ]);
  test("most frequent first, 'Other' always last, rest goes to the menu", () => {
    const { chips, more } = chipCategories(counts, [], 2);
    expect(chips).toEqual(["B", "C"]);
    expect(more).toEqual(["A", "D", "Other"]);
  });
  test("a selected category is always a chip so it never hides", () => {
    const { chips, more } = chipCategories(counts, ["D"], 2);
    expect(chips).toEqual(["B", "C", "D"]);
    expect(more).toEqual(["A", "Other"]);
  });
  test("a selected category with no item today is still shown", () => {
    const { chips } = chipCategories(counts, ["Gone"], 2);
    expect(chips).toContain("Gone");
  });
});

describe("hash state", () => {
  test("round-trips filters", () => {
    const f = {
      categories: ["Agents", "AI Security"],
      types: ["paper"],
      query: "kv cache",
      sort: "date" as const,
    };
    expect(readHash(writeHash(f))).toEqual(f);
  });
  test("default filters give an empty hash", () => {
    expect(writeHash(DEFAULT_FILTERS)).toBe("");
  });
  test("ignores garbage: unknown sort or type, empty values", () => {
    const f = readHash("#sort=evil&type=paper,hack&cat=,A,&q=");
    expect(f).toEqual({ categories: ["A"], types: ["paper"], query: "", sort: "trending" });
  });
});
