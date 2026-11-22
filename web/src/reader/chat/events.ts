export type ChatEvent =
  | { type: "thinking_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; summary: string; is_error: boolean }
  | { type: "text_delta"; text: string }
  | { type: "done"; duration_ms: number }
  | { type: "error"; kind: string; message: string };

const isStr = (v: unknown): v is string => typeof v === "string";

/** Accept only well-formed events; anything else from the stream is dropped. */
export function toEvent(raw: unknown): ChatEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "thinking_delta":
    case "text_delta":
      return isStr(r.text) ? { type: r.type, text: r.text } : null;
    case "tool_use":
      return isStr(r.id) && isStr(r.name) && typeof r.input === "object" && r.input !== null
        ? { type: "tool_use", id: r.id, name: r.name, input: r.input as Record<string, unknown> }
        : null;
    case "tool_result":
      return isStr(r.id) && isStr(r.summary)
        ? { type: "tool_result", id: r.id, summary: r.summary, is_error: r.is_error === true }
        : null;
    case "done":
      return typeof r.duration_ms === "number"
        ? { type: "done", duration_ms: r.duration_ms }
        : null;
    case "error":
      return isStr(r.kind) && isStr(r.message)
        ? { type: "error", kind: r.kind, message: r.message }
        : null;
    default:
      return null;
  }
}

/** Turn raw SSE text chunks into events (events may be split across chunks). */
export async function* parseSse(chunks: AsyncIterable<string>): AsyncIterable<ChatEvent> {
  let buffer = "";
  const emit = function* (block: string) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      const event = toEvent(JSON.parse(data));
      if (event) yield event;
    } catch {
      // a malformed line is skipped
    }
  };
  for await (const chunk of chunks) {
    buffer += chunk;
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) yield* emit(part);
  }
  if (buffer.trim()) yield* emit(buffer);
}
