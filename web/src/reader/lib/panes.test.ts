import { describe, expect, test } from "vitest";
import {
  clampRatio,
  DEFAULT_PANES,
  loadPanes,
  nudge,
  savePanes,
  toggleChat,
  togglePdf,
} from "./panes";

test("ratio is clamped", () => {
  expect(clampRatio(0.1)).toBe(0.25);
  expect(clampRatio(0.99)).toBe(0.8);
  expect(clampRatio(Number.NaN)).toBe(0.6);
});

test("nudge moves and clamps", () => {
  expect(nudge(DEFAULT_PANES, 0.02).ratio).toBeCloseTo(0.62);
  expect(nudge({ ...DEFAULT_PANES, ratio: 0.8 }, 0.02).ratio).toBe(0.8);
});

describe("collapse", () => {
  test("hiding one pane keeps the other", () => {
    expect(toggleChat(DEFAULT_PANES)).toMatchObject({ chatCollapsed: true, pdfCollapsed: false });
    expect(togglePdf(DEFAULT_PANES)).toMatchObject({ pdfCollapsed: true, chatCollapsed: false });
  });
  test("never both collapsed", () => {
    const chatOnly = togglePdf(DEFAULT_PANES);
    expect(toggleChat(chatOnly)).toMatchObject({ chatCollapsed: true, pdfCollapsed: false });
  });
  test("toggling again restores", () => {
    expect(toggleChat(toggleChat(DEFAULT_PANES))).toEqual(DEFAULT_PANES);
  });
});

describe("persistence", () => {
  const store = (value: string | null) => ({ getItem: () => value });
  test("null storage gives defaults", () => {
    expect(loadPanes(null)).toEqual(DEFAULT_PANES);
  });
  test("throwing storage gives defaults", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadPanes(throwing)).toEqual(DEFAULT_PANES);
  });
  test("garbage gives defaults", () => {
    expect(loadPanes(store("{nope"))).toEqual(DEFAULT_PANES);
    expect(loadPanes(store('"x"'))).toEqual(DEFAULT_PANES);
  });
  test("out of range values are clamped, both-collapsed is repaired", () => {
    const s = loadPanes(
      store(JSON.stringify({ ratio: 5, pdfCollapsed: true, chatCollapsed: true })),
    );
    expect(s.ratio).toBe(0.8);
    expect(s.pdfCollapsed && s.chatCollapsed).toBe(false);
  });
  test("save then load round trips; save tolerates missing or throwing storage", () => {
    let saved = "";
    savePanes(
      { setItem: (_k, v) => (saved = v) },
      { ratio: 0.4, pdfCollapsed: false, chatCollapsed: true },
    );
    expect(loadPanes({ getItem: () => saved })).toEqual({
      ratio: 0.4,
      pdfCollapsed: false,
      chatCollapsed: true,
    });
    expect(() => savePanes(null, DEFAULT_PANES)).not.toThrow();
    expect(() =>
      savePanes(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        DEFAULT_PANES,
      ),
    ).not.toThrow();
  });
});
