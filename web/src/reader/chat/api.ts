import { type ChatEvent, parseSse } from "./events";
import type { Block } from "./reducer";

export interface Conversation {
  id: number;
  item_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  text: string;
  page: number;
  rects: number[][];
}

export type StoredContent =
  | { text: string }
  | { quote: Quote; question: string }
  | {
      answer: string;
      blocks: Block[];
      duration_ms: number;
      stopped: boolean;
      error?: { kind: string; message: string };
    };

export interface StoredMessage {
  id: number;
  seq: number;
  role: "user" | "assistant";
  kind: string;
  content: Record<string, unknown>;
  created_at: string;
}

export type SendBody =
  | { kind: "text"; text: string }
  | { kind: "ask_agent"; quote: Quote; question: string };

export interface ChatApi {
  listConversations(item: string): Promise<Conversation[]>;
  createConversation(item: string, title: string): Promise<Conversation>;
  renameConversation(item: string, id: number, title: string): Promise<void>;
  deleteConversation(item: string, id: number): Promise<void>;
  messages(item: string, id: number): Promise<StoredMessage[]>;
  exportMarkdown(item: string, id: number): Promise<string>;
  send(item: string, id: number, body: SendBody, signal: AbortSignal): AsyncIterable<ChatEvent>;
  regenerate(item: string, id: number, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

const base = (item: string) => `/api/items/${encodeURIComponent(item)}/conversations`;

async function ok(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function* chunksOf(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield decoder.decode(value, { stream: true });
  }
}

async function* streamOf(request: Promise<Response>): AsyncIterable<ChatEvent> {
  const response = await ok(await request);
  if (!response.body) throw new Error("no response body");
  yield* parseSse(chunksOf(response.body));
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const httpChatApi: ChatApi = {
  async listConversations(item) {
    return (await (await ok(await fetch(base(item)))).json()) as Conversation[];
  },
  async createConversation(item, title) {
    const r = await ok(await fetch(base(item), { method: "POST", ...json({ title }) }));
    return (await r.json()) as Conversation;
  },
  async renameConversation(item, id, title) {
    await ok(await fetch(`${base(item)}/${id}`, { method: "PATCH", ...json({ title }) }));
  },
  async deleteConversation(item, id) {
    await ok(await fetch(`${base(item)}/${id}`, { method: "DELETE" }));
  },
  async messages(item, id) {
    return (await (
      await ok(await fetch(`${base(item)}/${id}/messages`))
    ).json()) as StoredMessage[];
  },
  async exportMarkdown(item, id) {
    return await (await ok(await fetch(`${base(item)}/${id}/export`))).text();
  },
  send(item, id, body, signal) {
    return streamOf(
      fetch(`${base(item)}/${id}/messages`, { method: "POST", ...json(body), signal }),
    );
  },
  regenerate(item, id, signal) {
    return streamOf(fetch(`${base(item)}/${id}/regenerate`, { method: "POST", signal }));
  },
};
