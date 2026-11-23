export type CitationStatus =
  | "verified"
  | "wrong_page"
  | "unverified"
  | "page_only"
  | "invalid_page";

/** The server's verdict on one citation of the answer. */
export interface Citation {
  page: number;
  quote: string | null;
  status: CitationStatus;
  section: string | null;
  found_page?: number;
}

const STATUSES: readonly string[] = [
  "verified",
  "wrong_page",
  "unverified",
  "page_only",
  "invalid_page",
];

/** Keep only well-formed citation verdicts (also used for stored messages). */
export function toCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.page !== "number" || !Number.isInteger(r.page)) continue;
    if (typeof r.status !== "string" || !STATUSES.includes(r.status)) continue;
    const citation: Citation = {
      page: r.page,
      quote: typeof r.quote === "string" ? r.quote : null,
      status: r.status as CitationStatus,
      section: typeof r.section === "string" ? r.section : null,
    };
    if (typeof r.found_page === "number" && Number.isInteger(r.found_page))
      citation.found_page = r.found_page;
    out.push(citation);
  }
  return out;
}

export const MAX_SUGGESTIONS = 3;
export const MAX_SUGGESTION_LENGTH = 120;

/** Keep the plain, short follow-up questions (the server checks too; this is a second guard). */
export function toSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (
      !text ||
      text.length > MAX_SUGGESTION_LENGTH ||
      /[<>`]/.test(text) ||
      [...text].some((c) => c.charCodeAt(0) < 32)
    )
      continue;
    if (!out.includes(text)) out.push(text);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

export type ChatEvent =
  | { type: "citations"; items: Citation[] }
  | { type: "suggestions"; items: string[] }
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
    case "citations":
      return Array.isArray(r.items) ? { type: "citations", items: toCitations(r.items) } : null;
    case "suggestions":
      return Array.isArray(r.items) ? { type: "suggestions", items: toSuggestions(r.items) } : null;
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
