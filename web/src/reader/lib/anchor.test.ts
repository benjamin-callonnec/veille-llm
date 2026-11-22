import { describe, expect, test } from "vitest";
import { parseHash, writeHash } from "./anchor";

describe("parseHash", () => {
  test.each([
    ["#item=a&page=3", { item: "a", page: 3 }],
    ["#item=a", { item: "a", page: null }],
    ["#item=a&page=0", { item: "a", page: null }],
    ["#item=a&page=x", { item: "a", page: null }],
    ["", { item: "", page: null }],
    ["#item=a%20b&page=2", { item: "a b", page: 2 }],
  ])("%s", (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });
});

test("writeHash round trips and omits an unset page", () => {
  expect(writeHash("a b", null)).toBe("#item=a%20b");
  expect(writeHash("a", 0)).toBe("#item=a");
  expect(parseHash(writeHash("a b/c", 7))).toEqual({ item: "a b/c", page: 7 });
});
