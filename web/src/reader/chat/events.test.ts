import { expect, test } from "vitest";
import { parseSse, toCitations } from "./events";

async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

async function collect(source: AsyncIterable<string>) {
  const out = [];
  for await (const e of parseSse(source)) out.push(e);
  return out;
}

const line = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

test("parses several events in one chunk", async () => {
  const out = await collect(
    chunks(line({ type: "text_delta", text: "a" }) + line({ type: "done", duration_ms: 5 })),
  );
  expect(out.map((e) => e.type)).toEqual(["text_delta", "done"]);
});

test("reassembles an event split across chunks", async () => {
  const whole = line({ type: "text_delta", text: "hello" });
  const out = await collect(chunks(whole.slice(0, 10), whole.slice(10, 25), whole.slice(25)));
  expect(out).toEqual([{ type: "text_delta", text: "hello" }]);
});

test("skips malformed or unknown events", async () => {
  const out = await collect(
    chunks(
      "data: {not json}\n\n",
      line({ type: "mystery" }),
      line({ type: "text_delta" }),
      line({ type: "text_delta", text: "ok" }),
      ": comment\n\n",
    ),
  );
  expect(out).toEqual([{ type: "text_delta", text: "ok" }]);
});

test("handles CRLF separators", async () => {
  const out = await collect(
    chunks(`data: ${JSON.stringify({ type: "done", duration_ms: 1 })}\r\n\r\n`),
  );
  expect(out).toHaveLength(1);
});

test("validates every event shape", async () => {
  const out = await collect(
    chunks(
      line({ type: "thinking_delta", text: "t" }),
      line({ type: "tool_use", id: "1", name: "n", input: { a: 1 } }),
      line({ type: "tool_result", id: "1", summary: "s", is_error: false }),
      line({ type: "error", kind: "limit", message: "m" }),
      line({ type: "tool_use", id: 1, name: "n", input: {} }),
    ),
  );
  expect(out.map((e) => e.type)).toEqual(["thinking_delta", "tool_use", "tool_result", "error"]);
});

test("a citations event keeps well-formed items and drops malformed ones", async () => {
  const out = await collect(
    chunks(
      line({
        type: "citations",
        items: [
          { page: 4, quote: "exact words", status: "verified", section: "Intro" },
          { page: 5, quote: null, status: "page_only", section: null },
          { page: 6, quote: "x", status: "wrong_page", section: null, found_page: 9 },
          { page: "7", quote: "x", status: "verified", section: null },
          { page: 8, quote: "x", status: "bogus", section: null },
          "nope",
        ],
      }),
    ),
  );
  expect(out).toEqual([
    {
      type: "citations",
      items: [
        { page: 4, quote: "exact words", status: "verified", section: "Intro" },
        { page: 5, quote: null, status: "page_only", section: null },
        { page: 6, quote: "x", status: "wrong_page", section: null, found_page: 9 },
      ],
    },
  ]);
});

test("a citations event without a list is dropped", async () => {
  expect(await collect(chunks(line({ type: "citations", items: "x" })))).toEqual([]);
});

test("a suggestions event keeps three plain, short questions at most", async () => {
  const out = await collect(
    chunks(
      line({
        type: "suggestions",
        items: [
          "Why does it work?",
          "<script>alert(1)</script>",
          "x".repeat(121),
          "`code`",
          7,
          "Why does it work?",
          "Second?",
          "Third?",
          "Fourth?",
        ],
      }),
    ),
  );
  expect(out).toEqual([{ type: "suggestions", items: ["Why does it work?", "Second?", "Third?"] }]);
});

test("a suggestions event without a list is dropped", async () => {
  expect(await collect(chunks(line({ type: "suggestions", items: "x" })))).toEqual([]);
});

test("parses the question of the tutor, its outcome and the note lines", async () => {
  const out = await collect(
    chunks(
      line({ type: "ask_user", id: "a", question: "Which?", options: ["A", "B"], timeout_s: 120 }) +
        line({ type: "ask_resolved", id: "a", status: "answered", answer: "B" }) +
        line({ type: "memory_note", action: "saved", text: "knows RNNs" }),
    ),
  );
  expect(out).toEqual([
    { type: "ask_user", id: "a", question: "Which?", options: ["A", "B"], timeout_s: 120 },
    { type: "ask_resolved", id: "a", status: "answered", answer: "B" },
    { type: "memory_note", action: "saved", text: "knows RNNs" },
  ]);
});

test("drops a malformed ask, keeps only plain options, and keeps the raisable flag", async () => {
  const out = await collect(
    chunks(
      line({ type: "ask_user", id: 5, question: "?" }) +
        line({ type: "ask_resolved", id: "a", status: "weird" }) +
        line({ type: "memory_note", action: "boom", text: "x" }) +
        line({
          type: "ask_user",
          id: "b",
          question: "Q",
          options: ["ok", 3, "", "x".repeat(200)],
        }) +
        line({ type: "error", kind: "budget", message: "m", raisable: true }),
    ),
  );
  expect(out).toEqual([
    { type: "ask_user", id: "b", question: "Q", options: ["ok"], timeout_s: 0 },
    { type: "error", kind: "budget", message: "m", raisable: true },
  ]);
});

test("a citation keeps its figure or table label, and only when it is a string", () => {
  expect(
    toCitations([
      { page: 4, quote: null, status: "page_only", section: null, label: "figure 2" },
      { page: 5, quote: null, status: "page_only", section: null, label: 5 },
    ]),
  ).toEqual([
    { page: 4, quote: null, status: "page_only", section: null, label: "figure 2" },
    { page: 5, quote: null, status: "page_only", section: null },
  ]);
});
