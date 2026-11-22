import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { ChatApi, Conversation, StoredMessage } from "./api";
import { ChatPane } from "./ChatPane";
import type { QuizApi } from "./quizApi";
import { useChat } from "./useChat";

afterEach(cleanup);

const conv: Conversation = { id: 1, item_id: "a1", title: "T", created_at: "", updated_at: "" };
const card = {
  id: 5,
  seq: 1,
  role: "system",
  kind: "quiz",
  content: { quiz_id: 9, kind: "choice", question: "Which one?", options: ["a", "b", "c", "d"] },
  created_at: "",
} as StoredMessage;

function Host({ chatApi, quizApi }: { chatApi: ChatApi; quizApi: QuizApi }) {
  const chat = useChat("a1", chatApi);
  return <ChatPane chat={chat} onGo={() => {}} itemId="a1" quizApi={quizApi} />;
}

function apis(withConversation: boolean) {
  const stored: StoredMessage[] = [];
  let exists = withConversation;
  const chatApi = {
    listConversations: async () => (exists ? [conv] : []),
    createConversation: vi.fn(async () => {
      exists = true;
      return conv;
    }),
    messages: async () => [...stored],
  } as unknown as ChatApi;
  const quizApi = {
    start: vi.fn(async () => {
      stored.push(card);
      return card;
    }),
    answer: vi.fn(),
  } as unknown as QuizApi;
  return { chatApi, quizApi };
}

test("the quiz icon makes a quiz in the current conversation and shows its card", async () => {
  const { chatApi, quizApi } = apis(true);
  render(<Host chatApi={chatApi} quizApi={quizApi} />);
  await screen.findByRole("button", { name: "Quiz me" });
  await userEvent.click(screen.getByRole("button", { name: "Quiz me" }));
  expect(quizApi.start).toHaveBeenCalledWith("a1", 1);
  expect(await screen.findByText("Which one?")).toBeTruthy();
});

test("without a conversation the quiz icon creates one first", async () => {
  const { chatApi, quizApi } = apis(false);
  render(<Host chatApi={chatApi} quizApi={quizApi} />);
  await userEvent.click(await screen.findByRole("button", { name: "Quiz me" }));
  await waitFor(() => expect(quizApi.start).toHaveBeenCalledWith("a1", 1));
  expect(chatApi.createConversation).toHaveBeenCalledOnce();
  expect(await screen.findByText("Which one?")).toBeTruthy();
});

test("a quiz that cannot be made says so", async () => {
  const { chatApi, quizApi } = apis(true);
  (quizApi.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("502"));
  render(<Host chatApi={chatApi} quizApi={quizApi} />);
  await userEvent.click(await screen.findByRole("button", { name: "Quiz me" }));
  expect(await screen.findByText("The quiz could not be made. Try again.")).toBeTruthy();
});
