import { afterEach, expect, test, vi } from "vitest";
import { type Caption, fetchCaptions, findCaption } from "./structureApi";

afterEach(() => vi.unstubAllGlobals());

const caption = (kind: "figure" | "table", number: number, page: number): Caption => ({
  kind,
  number,
  page,
  rect: [0.1, 0.5, 0.3, 0.02],
});
const all = [caption("figure", 2, 5), caption("figure", 2, 9), caption("table", 1, 3)];

test("the caption on the cited page wins", () => {
  expect(findCaption(all, { kind: "figure", number: 2 }, 9)?.page).toBe(9);
});

test("a caption on another page is found when the cited page is wrong", () => {
  expect(findCaption(all, { kind: "table", number: 1 }, 7)?.page).toBe(3);
});

test("a figure that does not exist gives nothing", () => {
  expect(findCaption(all, { kind: "figure", number: 9 }, 5)).toBeUndefined();
  expect(findCaption([], { kind: "figure", number: 2 }, 5)).toBeUndefined();
});

test("the captions are read from the structure of the paper", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ captions: all })));
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchCaptions("a/1")).toEqual(all);
  expect(fetchMock).toHaveBeenCalledWith("/api/items/a%2F1/structure");
});

test("no structure, a server error or a network failure give no captions", async () => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  expect(await fetchCaptions("a1")).toEqual([]);
  vi.stubGlobal("fetch", async () => {
    throw new Error("down");
  });
  expect(await fetchCaptions("a1")).toEqual([]);
});
