import { type QuizResult, toResult } from "../lib/quiz";
import type { StoredMessage } from "./api";

export type AnswerBody = { choice: number } | { text: string };

export interface QuizApi {
  /** Make a quiz in a conversation; resolves to the card message (question and options only). */
  start(item: string, conversation: number, focus?: string): Promise<StoredMessage>;
  answer(item: string, quiz: number, body: AnswerBody): Promise<QuizResult>;
}

async function ok(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const root = (item: string) => `/api/items/${encodeURIComponent(item)}`;

export const httpQuizApi: QuizApi = {
  async start(item, conversation, focus = "") {
    const r = await ok(
      await fetch(`${root(item)}/conversations/${conversation}/quizzes`, post({ focus })),
    );
    return (await r.json()) as StoredMessage;
  },
  async answer(item, quiz, body) {
    const r = await ok(await fetch(`${root(item)}/quizzes/${quiz}/answer`, post(body)));
    const result = toResult(await r.json());
    if (!result) throw new Error("unreadable result");
    return result;
  },
};
