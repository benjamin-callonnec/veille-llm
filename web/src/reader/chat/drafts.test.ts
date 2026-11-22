import { afterEach, expect, test, vi } from "vitest";
import { loadDraft, resetDrafts, saveDraft } from "./drafts";

afterEach(() => {
  resetDrafts();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

test("a draft comes back for its conversation only", () => {
  saveDraft("c1", "half a question");
  expect(loadDraft("c1")).toBe("half a question");
  expect(loadDraft("c2")).toBe("");
});

test("it survives a reload through sessionStorage", () => {
  saveDraft("c1", "kept");
  resetDrafts();
  expect(loadDraft("c1")).toBe("kept");
});

test("an emptied draft is forgotten", () => {
  saveDraft("c1", "x");
  saveDraft("c1", "");
  resetDrafts();
  expect(loadDraft("c1")).toBe("");
});

test("works when storage throws", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
  saveDraft("c1", "still here");
  expect(loadDraft("c1")).toBe("still here");
  resetDrafts();
  expect(loadDraft("c1")).toBe("");
  vi.unstubAllGlobals();
});
