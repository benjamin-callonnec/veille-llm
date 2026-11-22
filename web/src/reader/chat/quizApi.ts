import { type QuizContent, type QuizResult, toQuiz, toResult } from "../lib/quiz";
import type { StoredMessage } from "./api";

export type AnswerBody =
  | { choice: number }
  | { choices: number[] }
  | { words: string[] }
  | { order: number[] }
  | { text: string };

/** A request the server refused: the HTTP status and the reason it gave. */
export class QuizApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`HTTP ${status}${reason ? ` ${reason}` : ""}`);
  }
}

export interface QuizApi {
  /** Make a quiz in a conversation; resolves to the card message (question and options only). */
  start(item: string, conversation: number, focus?: string, kind?: string): Promise<StoredMessage>;
  answer(item: string, quiz: number, body: AnswerBody): Promise<QuizResult>;
  /** The quiz as the server shows it now (with its result once answered), null when unreadable. */
  get(item: string, quiz: number): Promise<QuizContent | null>;
}

async function ok(response: Response): Promise<Response> {
  if (!response.ok) {
    let reason = "";
    try {
      const body = (await response.json()) as { reason?: unknown };
      if (typeof body.reason === "string") reason = body.reason;
    } catch {
      // no body to read: the status says enough
    }
    throw new QuizApiError(response.status, reason);
  }
  return response;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The paper's route; never with an empty id (that would hit another route and answer 405). */
function root(item: string): string {
  if (!item) throw new Error("a quiz needs the id of its paper");
  return `/api/items/${encodeURIComponent(item)}`;
}

export const httpQuizApi: QuizApi = {
  async start(item, conversation, focus = "", kind = "any") {
    const url = `${root(item)}/conversations/${conversation}/quizzes`;
    const r = await ok(await fetch(url, post({ focus, kind })));
    return (await r.json()) as StoredMessage;
  },
  async answer(item, quiz, body) {
    const r = await ok(await fetch(`${root(item)}/quizzes/${quiz}/answer`, post(body)));
    const result = toResult(await r.json());
    if (!result) throw new Error("unreadable result");
    return result;
  },
  async get(item, quiz) {
    const r = await ok(await fetch(`${root(item)}/quizzes/${quiz}`));
    return toQuiz(await r.json());
  },
};
