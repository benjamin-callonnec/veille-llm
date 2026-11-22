import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { ChatApi, Conversation, StoredMessage } from "./api";
import { ChatPane } from "./ChatPane";
import type { ChatEvent } from "./events";
import { useChat } from "./useChat";

afterEach(cleanup);

function makeApi(gate: Promise<void>) {
  const store: StoredMessage[] = [];
  const conv: Conversation = { id: 1, item_id: "a1", title: "T", created_at: "", updated_at: "" };
  let created = false;
  const api: ChatApi = {
    listConversations: async () => (created ? [conv] : []),
    createConversation: async () => {
      created = true;
      return conv;
    },
    renameConversation: async () => {},
    deleteConversation: async () => {},
    messages: async () => [...store],
    exportMarkdown: async () => "# md",
    async *send(_i, _id, body, signal) {
      store.push({
        id: 1,
        seq: 1,
        role: "user",
        kind: "text",
        content: { text: (body as { text: string }).text },
        created_at: "",
      });
      const events: ChatEvent[] = [
        { type: "thinking_delta", text: "reasoning about it" },
        { type: "text_delta", text: "The answer " },
      ];
      for (const e of events) yield e;
      await gate;
      if (signal.aborted) {
        store.push({
          id: 2,
          seq: 2,
          role: "assistant",
          kind: "assistant",
          content: {
            answer: "The answer ",
            blocks: [{ type: "thinking", text: "reasoning about it" }],
            duration_ms: 1500,
            stopped: true,
          },
          created_at: "",
        });
        return;
      }
      yield { type: "text_delta", text: "is 42 [p.3]" };
      yield { type: "done", duration_ms: 2000 };
      store.push({
        id: 2,
        seq: 2,
        role: "assistant",
        kind: "assistant",
        content: {
          answer: "The answer is 42 [p.3]",
          blocks: [{ type: "thinking", text: "reasoning about it" }],
          duration_ms: 2000,
          stopped: false,
        },
        created_at: "",
      });
    },
    async *regenerate() {},
  };
  return api;
}

function Host({ api, onGo }: { api: ChatApi; onGo: (p: number) => void }) {
  const chat = useChat("a1", api);
  return <ChatPane chat={chat} onGo={onGo} />;
}

test("sending streams the answer, thinking folds when it starts and reopens on demand", async () => {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const onGo = vi.fn();
  render(<Host api={makeApi(gate)} onGo={onGo} />);
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Message" }),
    "What is it?{Enter}",
  );
  expect(await screen.findByText("The answer")).toBeTruthy();
  expect(screen.queryByText("reasoning about it")).toBeNull(); // folded: the answer started
  await userEvent.click(screen.getByRole("button", { name: /Thinking/ }));
  expect(screen.getByText("reasoning about it")).toBeTruthy();
  open();
  expect(await screen.findByRole("button", { name: "p.3" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "p.3" }));
  expect(onGo).toHaveBeenCalledWith(3);
  await waitFor(() => expect(screen.getByRole("button", { name: /Thought for 2s/ })).toBeTruthy());
  await userEvent.click(screen.getByRole("button", { name: /Thought for 2s/ }));
  expect(screen.getByText("reasoning about it")).toBeTruthy();
});

test("stop leaves the partial answer", async () => {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  render(<Host api={makeApi(gate)} onGo={() => {}} />);
  await userEvent.type(await screen.findByRole("textbox", { name: "Message" }), "Q{Enter}");
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
  open();
  await waitFor(() => expect(screen.getByText(/stopped/i)).toBeTruthy());
  expect(screen.getByText("The answer")).toBeTruthy();
});

test("an empty chat invites the user to ask", async () => {
  render(<Host api={makeApi(Promise.resolve())} onGo={() => {}} />);
  expect(await screen.findByText(/ask about the paper|select a passage/i)).toBeTruthy();
});

test("the conversation menu is disabled while an answer streams", async () => {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  render(<Host api={makeApi(gate)} onGo={() => {}} />);
  await userEvent.type(await screen.findByRole("textbox", { name: "Message" }), "Q{Enter}");
  const menu = await screen.findByRole("button", { name: /T ▾/ });
  expect((menu as HTMLButtonElement).disabled).toBe(true);
  open();
  await waitFor(() =>
    expect((screen.getByRole("button", { name: /T ▾/ }) as HTMLButtonElement).disabled).toBe(false),
  );
});
