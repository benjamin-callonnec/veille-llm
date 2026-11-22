import { describe, expect, test } from "vitest";
import { findAll } from "./search";

const pages = [
  { page: 1, text: "Attention is all you need" },
  { page: 2, text: "attention   again,\nATTENTION" },
];

describe("findAll", () => {
  test("is case-insensitive and normalises whitespace", () => {
    const hits = findAll(pages, "attention");
    expect(hits.map((h) => h.page)).toEqual([1, 2, 2]);
    expect(hits[0]).toMatchObject({ start: 0, end: 9 });
  });
  test("finds a phrase across collapsed whitespace", () => {
    expect(findAll(pages, "attention again")).toHaveLength(1);
  });
  test("overlapping matches are all found", () => {
    expect(findAll([{ page: 1, text: "aaa" }], "aa")).toHaveLength(2);
  });
  test("empty or blank query gives nothing", () => {
    expect(findAll(pages, "")).toEqual([]);
    expect(findAll(pages, "   ")).toEqual([]);
  });
  test("accents are left alone", () => {
    expect(findAll([{ page: 1, text: "café" }], "cafe")).toEqual([]);
  });
  test("is capped at 500 hits", () => {
    expect(findAll([{ page: 1, text: "a ".repeat(2000) }], "a")).toHaveLength(500);
  });
  test("snippet is trimmed around the hit", () => {
    const long = `${"x".repeat(200)} needle ${"y".repeat(200)}`;
    const [hit] = findAll([{ page: 1, text: long }], "needle");
    expect(hit?.snippet).toContain("needle");
    expect(hit?.snippet.length).toBeLessThan(90);
  });
});
