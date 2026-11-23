import type { AskStatus, ChatEvent, Citation } from "./events";

export type Block =
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      summary: string | null;
      is_error: boolean;
    };

/** A question of the tutor to the user, as the card shows it. */
export interface AskCardState {
  id: string;
  question: string;
  options: string[];
  status: AskStatus;
  answer?: string;
}

/** A note the tutor saved or deleted, shown as a quiet line. */
export interface NoteLine {
  action: "saved" | "deleted";
  text: string;
}

export interface AssistantState {
  blocks: Block[];
  answer: string;
  thinkingOpen: boolean;
  userToggled: boolean;
  startedAt: number;
  durationMs: number | null;
  status: "streaming" | "done" | "stopped" | "error";
  error?: { kind: string; message: string; raisable?: boolean };
  asks?: AskCardState[];
  notes?: NoteLine[];
  /** The server's verdicts on the answer's citations, sent just before the end. */
  citations?: Citation[];
  /** Follow-up questions the tutor proposes (sent just before the end). */
  suggestions?: string[];
}

export const initialAssistant = (now: number): AssistantState => ({
  blocks: [],
  answer: "",
  thinkingOpen: true,
  userToggled: false,
  startedAt: now,
  durationMs: null,
  status: "streaming",
});

/** Thinking is open until the answer starts, then folds by itself (unless the user touched it). */
export function applyEvent(s: AssistantState, event: ChatEvent, now: number): AssistantState {
  switch (event.type) {
    case "thinking_delta": {
      const last = s.blocks[s.blocks.length - 1];
      const blocks: Block[] =
        last?.type === "thinking"
          ? [...s.blocks.slice(0, -1), { type: "thinking", text: last.text + event.text }]
          : [...s.blocks, { type: "thinking", text: event.text }];
      return { ...s, blocks };
    }
    case "tool_use":
      return {
        ...s,
        blocks: [
          ...s.blocks,
          {
            type: "tool",
            id: event.id,
            name: event.name,
            input: event.input,
            summary: null,
            is_error: false,
          },
        ],
      };
    case "tool_result":
      return {
        ...s,
        blocks: s.blocks.map((b) =>
          b.type === "tool" && b.id === event.id
            ? { ...b, summary: event.summary, is_error: event.is_error }
            : b,
        ),
      };
    case "text_delta":
      return {
        ...s,
        answer: s.answer + event.text,
        thinkingOpen: s.userToggled ? s.thinkingOpen : false,
      };
    case "ask_user":
      return {
        ...s,
        asks: [
          ...(s.asks ?? []),
          {
            id: event.id,
            question: event.question,
            options: event.options,
            status: "pending",
          },
        ],
      };
    case "ask_resolved":
      return {
        ...s,
        asks: (s.asks ?? []).map((a) =>
          a.id === event.id
            ? { ...a, status: event.status, ...(event.answer ? { answer: event.answer } : {}) }
            : a,
        ),
      };
    case "memory_note":
      return { ...s, notes: [...(s.notes ?? []), { action: event.action, text: event.text }] };
    case "citations":
      return { ...s, citations: event.items };
    case "suggestions":
      return { ...s, suggestions: event.items };
    case "done":
      return { ...s, status: "done", durationMs: event.duration_ms };
    case "error":
      return {
        ...s,
        status: "error",
        durationMs: now - s.startedAt,
        error: {
          kind: event.kind,
          message: event.message,
          ...(event.raisable ? { raisable: true } : {}),
        },
      };
  }
}

export const toggleThinking = (s: AssistantState): AssistantState => ({
  ...s,
  thinkingOpen: !s.thinkingOpen,
  userToggled: true,
});

export const stop = (s: AssistantState, now: number): AssistantState => ({
  ...s,
  status: "stopped",
  durationMs: now - s.startedAt,
});
