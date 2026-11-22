import { expect, test } from "vitest";
import { parseSse } from "./events";

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
