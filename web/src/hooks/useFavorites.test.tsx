import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { type FavoritesApi, useFavorites } from "./useFavorites";

const snapshot = (id: string) => ({
  id,
  title: `Title ${id}`,
  url: "https://e.com",
  published: "2026-11-20T00:00:00Z",
  category: "Agents",
  hook: "Hook.",
  score: 7,
  type: "news",
});

const fakeApi = (ids: string[] = []): FavoritesApi & { ids: string[] } => {
  const state = { ids: [...ids] };
  return {
    get ids() {
      return state.ids;
    },
    list: async () => state.ids.map((id) => ({ item_id: id, item: snapshot(id), added_at: "x" })),
    add: async (id) => {
      state.ids = [id, ...state.ids.filter((i) => i !== id)];
    },
    remove: async (id) => {
      state.ids = state.ids.filter((i) => i !== id);
    },
  };
};

test("loads the favorites, then adds and removes one", async () => {
  const api = fakeApi(["a"]);
  const { result } = renderHook(() => useFavorites(api));
  await waitFor(() => expect(result.current.ids.has("a")).toBe(true));
  expect(result.current.saved.map((i) => i.title)).toEqual(["Title a"]);
  await act(() => result.current.toggle("b"));
  expect([...result.current.ids].sort()).toEqual(["a", "b"]);
  expect(api.ids).toEqual(["b", "a"]);
  await act(() => result.current.toggle("a"));
  expect([...result.current.ids]).toEqual(["b"]);
});

test("a failed change is undone from the server's list", async () => {
  const api = { ...fakeApi(["a"]), add: async () => Promise.reject(new Error("down")) };
  const { result } = renderHook(() => useFavorites(api));
  await waitFor(() => expect(result.current.ids.size).toBe(1));
  await act(() => result.current.toggle("b"));
  expect([...result.current.ids]).toEqual(["a"]);
});

test("quick toggles reach the server in order and the star ends where the user left it", async () => {
  const api = fakeApi();
  const slowAdd = api.add;
  api.add = async (id) => {
    await new Promise((r) => setTimeout(r, 30)); // a slow PUT must not land after the DELETE
    await slowAdd(id);
  };
  const { result } = renderHook(() => useFavorites(api));
  await act(async () => {
    void result.current.toggle("a");
  });
  await act(async () => {
    await result.current.toggle("a");
  });
  await waitFor(() => expect(api.ids).toEqual([]));
  await waitFor(() => expect(result.current.ids.size).toBe(0));
});

test("malformed saved copies are dropped, their ids are kept", async () => {
  const api: FavoritesApi = {
    list: async () => [{ item_id: "x", item: { id: "x" }, added_at: "x" }, null],
    add: async () => {},
    remove: async () => {},
  };
  const { result } = renderHook(() => useFavorites(api));
  await waitFor(() => expect(result.current.ids.has("x")).toBe(true));
  expect(result.current.saved).toEqual([]);
});

test("without the reader nothing is ever fetched", () => {
  const list = vi.fn();
  const { result } = renderHook(() => useFavorites(null));
  expect(list).not.toHaveBeenCalled();
  expect(result.current.ids.size).toBe(0);
});
