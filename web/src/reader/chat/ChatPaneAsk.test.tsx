import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { ChatApi, Conversation, StoredMessage } from "./api";
import type { AskApi } from "./askApi";
import { ChatPane } from "./ChatPane";
import type { ChatEvent } from "./events";
import { useChat } from "./useChat";

afterEach(cleanup);

const conv: Conversation = { id: 4, item_id: "a1", title: "T", created_at: "", updated_at: "" };
const msg = (over: Partial<StoredMessage>): StoredMessage => ({
  id: 1,
  seq: 1,
  role: "assistant",
  kind: "assistant",
  content: {},
  created_at: "",
  ...over,
});

function Host({ api, askApi }: { api: ChatApi; askApi: AskApi }) {
  const chat = useChat("a1", api);
  return <ChatPane chat={chat} onGo={() => {}} askApi={askApi} />;
}

function chatApi(
  stored: StoredMessage[],
  send?: ChatApi["send"],
  regenerate?: ChatApi["regenerate"],
) {
  return {
    listConversations: async () => [conv],
    createConversation: async () => conv,
    messages: async () => [...stored],
    send: send ?? async function* () {},
    regenerate: regenerate ?? async function* () {},
  } as unknown as ChatApi;
}

test("the card pauses the answer; your reply goes to the server and the answer carries on", async () => {
  let resolve: () => void = () => {};
  const replied = new Promise<void>((r) => {
    resolve = r;
  });
  const askApi: AskApi = {
    answer: vi.fn(async () => {
      resolve();
    }),
  };
  const stored: StoredMessage[] = [];
  async function* send(): AsyncIterable<ChatEvent> {
    yield { type: "text_delta", text: "Let me check. " };
    yield {
      type: "ask_user",
      id: "k1",
      question: "Which part?",
      options: ["Intro", "Method"],
      timeout_s: 60,
    };
    await replied;
    yield { type: "ask_resolved", id: "k1", status: "answered", answer: "Method" };
    yield { type: "memory_note", action: "saved", text: "prefers the method" };
    yield { type: "text_delta", text: "Then the method." };
    stored.push(
      msg({
        id: 2,
        seq: 2,
        role: "system",
        kind: "memory",
        content: { action: "saved", text: "prefers the method" },
      }),
      msg({
        id: 3,
        seq: 3,
        content: {
          answer: "Let me check. Then the method.",
          blocks: [],
          duration_ms: 10,
          stopped: false,
        },
      }),
    );
    yield { type: "done", duration_ms: 10 };
  }
  render(<Host api={chatApi(stored, send)} askApi={askApi} />);
  await userEvent.type(
    await screen.findByRole("textbox", { name: /message|ask|question/i }),
    "Explain{Enter}",
  );
  await userEvent.click(await screen.findByRole("button", { name: "Method" }));
  expect(askApi.answer).toHaveBeenCalledWith("a1", 4, "k1", "Method");
  expect(await screen.findByText("The tutor saved a note: prefers the method")).toBeTruthy();
  expect(await screen.findByText(/Then the method/)).toBeTruthy();
});

test("stored cards show how they ended, and a note line is visible after a reload", async () => {
  const stored = [
    msg({
      id: 1,
      seq: 1,
      role: "system",
      kind: "ask",
      content: { id: "a", question: "Which?", options: [], status: "answered", answer: "Intro" },
    }),
    msg({
      id: 2,
      seq: 2,
      role: "system",
      kind: "ask",
      content: { id: "b", question: "Again?", options: [], status: "expired" },
    }),
    msg({
      id: 3,
      seq: 3,
      role: "system",
      kind: "memory",
      content: { action: "saved", text: "likes proofs" },
    }),
    msg({
      id: 4,
      seq: 4,
      role: "system",
      kind: "memory",
      content: { action: "deleted", text: "" },
    }),
    msg({
      id: 5,
      seq: 5,
      content: { answer: "Done.", blocks: [], duration_ms: 1, stopped: false },
    }),
  ];
  render(<Host api={chatApi(stored)} askApi={{ answer: vi.fn() }} />);
  expect(await screen.findByText("Intro")).toBeTruthy();
  expect(screen.getByText(/No answer in time/)).toBeTruthy();
  expect(screen.getByText("The tutor saved a note: likes proofs")).toBeTruthy();
  expect(screen.getByText("The tutor removed a note.")).toBeTruthy();
});

test("the raise icon of the last refusal runs the last question again with the raised limit", async () => {
  const stored = [
    msg({ id: 1, seq: 1, role: "user", kind: "text", content: { text: "Why?" } }),
    msg({
      id: 2,
      seq: 2,
      content: {
        answer: "",
        blocks: [],
        duration_ms: 1,
        stopped: false,
        error: { kind: "budget", message: "Budget reached.", raisable: true },
      },
    }),
  ];
  const regenerate = vi.fn(async function* (
    _item: string,
    _id: number,
    _signal: AbortSignal,
    _raise?: boolean,
  ) {
    yield { type: "done", duration_ms: 1 } as ChatEvent;
  });
  render(<Host api={chatApi(stored, undefined, regenerate)} askApi={{ answer: vi.fn() }} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Continue with a raised limit" }),
  );
  await waitFor(() => expect(regenerate).toHaveBeenCalled());
  expect(regenerate.mock.calls[0]?.[3]).toBe(true);
});

test("a stored summary note opens to its text", async () => {
  const stored = [
    msg({
      id: 1,
      seq: 1,
      role: "system",
      kind: "compaction",
      content: { summary: "We covered X.", replaced: 6 },
    }),
  ];
  render(<Host api={chatApi(stored)} askApi={{ answer: vi.fn() }} />);
  await userEvent.click(await screen.findByRole("button", { name: /summarised/ }));
  expect(screen.getByText("We covered X.")).toBeTruthy();
});
