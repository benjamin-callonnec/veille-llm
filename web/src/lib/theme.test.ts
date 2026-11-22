import { describe, expect, test } from "vitest";
import { applyTheme, initTheme, loadTheme, saveTheme } from "./theme";

const store = (value: string | null) => ({ getItem: () => value });

describe("loadTheme", () => {
  test("defaults to auto", () => {
    expect(loadTheme(null)).toBe("auto");
    expect(loadTheme(store(null))).toBe("auto");
  });
  test("reads a stored theme", () => {
    expect(loadTheme(store("light"))).toBe("light");
    expect(loadTheme(store("dark"))).toBe("dark");
  });
  test("ignores garbage and throwing storage", () => {
    expect(loadTheme(store("purple"))).toBe("auto");
    expect(loadTheme(store("<script>"))).toBe("auto");
    expect(
      loadTheme({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe("auto");
  });
});

test("saveTheme stores the value and survives a failing storage", () => {
  let saved = "";
  saveTheme({ setItem: (_k, v) => (saved = v) }, "dark");
  expect(saved).toBe("dark");
  expect(() => saveTheme(null, "dark")).not.toThrow();
  expect(() =>
    saveTheme(
      {
        setItem: () => {
          throw new Error("full");
        },
      },
      "light",
    ),
  ).not.toThrow();
});

describe("applyTheme", () => {
  test("light and dark set the attribute, auto removes it", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    applyTheme("auto", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

test("initTheme applies the stored theme and returns it", () => {
  const root = document.createElement("html");
  expect(initTheme(store("dark"), root)).toBe("dark");
  expect(root.dataset.theme).toBe("dark");
});
