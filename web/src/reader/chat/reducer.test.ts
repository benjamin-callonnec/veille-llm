import { describe, expect, test } from "vitest";
import { applyEvent, initialAssistant, stop, toggleThinking } from "./reducer";

const start = () => initialAssistant(1000);

describe("thinking folding", () => {
  test("stays open while only thinking and tool events arrive", () => {
    let s = start();
    s = applyEvent(s, { type: "thinking_delta", text: "hm" }, 1100);
    s = applyEvent(s, { type: "tool_use", id: "t", name: "x", input: {} }, 1200);
    s = applyEvent(s, { type: "tool_result", id: "t", summary: "ok", is_error: false }, 1300);
    expect(s.thinkingOpen).toBe(true);
    expect(s.status).toBe("streaming");
  });

  test("folds at the first answer token", () => {
    let s = applyEvent(start(), { type: "thinking_delta", text: "hm" }, 1100);
    s = applyEvent(s, { type: "text_delta", text: "Hel" }, 1200);
    expect(s.thinkingOpen).toBe(false);
    s = applyEvent(s, { type: "text_delta", text: "lo" }, 1300);
    expect(s.answer).toBe("Hello");
  });

  test("stays open if the user opened it before the answer", () => {
    let s = toggleThinking(applyEvent(start(), { type: "thinking_delta", text: "hm" }, 1100));
    expect(s.thinkingOpen).toBe(false); // the user folded it
    s = toggleThinking(s);
    expect(s.thinkingOpen).toBe(true); // and reopened it
    s = applyEvent(s, { type: "text_delta", text: "x" }, 1200);
    expect(s.thinkingOpen).toBe(true);
  });

  test("can be reopened after the answer", () => {
    let s = applyEvent(start(), { type: "text_delta", text: "x" }, 1100);
    expect(s.thinkingOpen).toBe(false);
    s = toggleThinking(s);
    expect(s.thinkingOpen).toBe(true);
    s = toggleThinking(s);
    expect(s.thinkingOpen).toBe(false);
  });

  test("a direct answer without thinking keeps it folded", () => {
    const s = applyEvent(start(), { type: "text_delta", text: "x" }, 1100);
    expect(s.thinkingOpen).toBe(false);
    expect(s.blocks).toEqual([]);
  });
});

describe("blocks and status", () => {
  test("thinking text accumulates in one block, a tool starts a new one", () => {
    let s = applyEvent(start(), { type: "thinking_delta", text: "a" }, 1);
    s = applyEvent(s, { type: "thinking_delta", text: "b" }, 2);
    s = applyEvent(s, { type: "tool_use", id: "t", name: "search_paper", input: { q: 1 } }, 3);
    s = applyEvent(s, { type: "thinking_delta", text: "c" }, 4);
    expect(s.blocks.map((b) => b.type)).toEqual(["thinking", "tool", "thinking"]);
    expect(s.blocks[0]).toMatchObject({ type: "thinking", text: "ab" });
  });

  test("a tool result fills its tool", () => {
    let s = applyEvent(start(), { type: "tool_use", id: "t", name: "x", input: {} }, 1);
    s = applyEvent(s, { type: "tool_result", id: "t", summary: "3 hits", is_error: true }, 2);
    expect(s.blocks[0]).toMatchObject({ summary: "3 hits", is_error: true });
  });

  test("done sets the duration and status", () => {
    const s = applyEvent(start(), { type: "done", duration_ms: 4200 }, 5000);
    expect(s.status).toBe("done");
    expect(s.durationMs).toBe(4200);
  });

  test("an error keeps the streamed text", () => {
    let s = applyEvent(start(), { type: "text_delta", text: "part" }, 1100);
    s = applyEvent(s, { type: "error", kind: "limit", message: "limit reached" }, 1200);
    expect(s.status).toBe("error");
    expect(s.answer).toBe("part");
    expect(s.error).toEqual({ kind: "limit", message: "limit reached" });
  });

  test("stop marks the answer stopped with a duration from the clock", () => {
    const s = stop(applyEvent(start(), { type: "text_delta", text: "x" }, 1100), 3000);
    expect(s.status).toBe("stopped");
    expect(s.durationMs).toBe(2000);
  });
});

test("the citations event is kept in the state", () => {
  const items = [{ page: 2, quote: null, status: "page_only" as const, section: null }];
  const s = applyEvent(start(), { type: "citations", items }, 1100);
  expect(s.citations).toEqual(items);
  expect(start().citations).toBeUndefined();
});
