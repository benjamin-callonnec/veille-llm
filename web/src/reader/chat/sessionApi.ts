/** The tutor's notes about a paper, and what each of its turns did (author's view). */
export const MAX_NOTES = 30;
export const MAX_NOTE = 500;

export interface Note {
  id: number;
  text: string;
  created_at: string;
  /** Who wrote it: you, or the tutor. */
  source: "user" | "tutor";
}

export interface TraceTool {
  name: string;
  is_error: boolean;
  duration_ms: number;
}

export interface TraceTurn {
  created_at: string;
  duration_ms: number;
  tools: TraceTool[];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  model: string;
  stopped: boolean;
  error_kind: string;
}

/** A refused request: the HTTP status and the reason the server gave. */
export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`HTTP ${status}${reason ? ` ${reason}` : ""}`);
  }
}

export interface SessionApi {
  notes(item: string): Promise<Note[]>;
  addNote(item: string, text: string): Promise<Note>;
  editNote(item: string, id: number, text: string): Promise<Note>;
  deleteNote(item: string, id: number): Promise<void>;
  trace(item: string, conversation: number): Promise<TraceTurn[]>;
}

async function ok(response: Response): Promise<Response> {
  if (!response.ok) {
    let reason = "";
    try {
      const body = (await response.json()) as { reason?: unknown };
      if (typeof body.reason === "string") reason = body.reason;
    } catch {
      // the status says enough
    }
    throw new SessionApiError(response.status, reason);
  }
  return response;
}

const memory = (item: string) => `/api/items/${encodeURIComponent(item)}/memory`;
const json = (text: string): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text }),
});

export const httpSessionApi: SessionApi = {
  async notes(item) {
    return (await (await ok(await fetch(memory(item)))).json()) as Note[];
  },
  async addNote(item, text) {
    return (await (
      await ok(await fetch(memory(item), { method: "POST", ...json(text) }))
    ).json()) as Note;
  },
  async editNote(item, id, text) {
    return (await (
      await ok(await fetch(`${memory(item)}/${id}`, { method: "PUT", ...json(text) }))
    ).json()) as Note;
  },
  async deleteNote(item, id) {
    await ok(await fetch(`${memory(item)}/${id}`, { method: "DELETE" }));
  },
  async trace(item, conversation) {
    const url = `/api/items/${encodeURIComponent(item)}/conversations/${conversation}/trace`;
    return (await (await ok(await fetch(url))).json()) as TraceTurn[];
  },
};
