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
  expect(quizApi.start).toHaveBeenCalledWith("a1", 1, "", "any");
  expect(await screen.findByText("Which one?")).toBeTruthy();
});

test("without a conversation the quiz icon creates one first", async () => {
  const { chatApi, quizApi } = apis(false);
  render(<Host chatApi={chatApi} quizApi={quizApi} />);
  await userEvent.click(await screen.findByRole("button", { name: "Quiz me" }));
  await waitFor(() => expect(quizApi.start).toHaveBeenCalledWith("a1", 1, "", "any"));
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

test("while a quiz starts and once its card is last, no suggested prompt is offered", async () => {
  const answer = {
    id: 3,
    seq: 1,
    role: "assistant",
    kind: "assistant",
    content: { answer: "Done.", blocks: [], suggestions: ["First idea?", "Second idea?"] },
    created_at: "",
  } as unknown as StoredMessage;
  const { chatApi, quizApi } = apis(true);
  const base = chatApi.messages;
  const stored = [answer];
  chatApi.messages = async (...a) => [...stored, ...(await base(...a))];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  (quizApi.start as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    await gate;
    stored.push(card);
    return card;
  });
  render(<Host chatApi={chatApi} quizApi={quizApi} />);
  expect(await screen.findByRole("button", { name: "Second idea?" })).toBeTruthy();
  expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("First idea?");

  await userEvent.click(screen.getByRole("button", { name: "Quiz me" }));
  expect(screen.queryByRole("button", { name: "Second idea?" })).toBeNull();
  expect(screen.getByRole("textbox").getAttribute("placeholder")).not.toBe("First idea?");

  release();
  expect(await screen.findByText("Which one?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Second idea?" })).toBeNull();
  expect(screen.getByRole("textbox").getAttribute("placeholder")).not.toBe("First idea?");
});
