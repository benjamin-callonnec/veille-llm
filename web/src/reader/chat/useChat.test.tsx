import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ChatApi, Conversation, StoredMessage } from "./api";
import type { ChatEvent } from "./events";
import { useChat } from "./useChat";

function fakeApi(script: ChatEvent[] = [], hold?: Promise<void>) {
  const conversations: Conversation[] = [];
  const messages = new Map<number, StoredMessage[]>();
  const sent: unknown[] = [];
  const signals: AbortSignal[] = [];
  let next = 1;
  const api: ChatApi = {
    listConversations: async () => [...conversations].reverse(),
    createConversation: async (_item, title) => {
      const c = { id: next++, item_id: "a1", title, created_at: "t", updated_at: "t" };
      conversations.push(c);
      messages.set(c.id, []);
      return c;
    },
    renameConversation: async (_i, id, title) => {
      const c = conversations.find((x) => x.id === id);
      if (c) c.title = title;
    },
    deleteConversation: async (_i, id) => {
      conversations.splice(
        conversations.findIndex((x) => x.id === id),
        1,
      );
    },
    messages: async (_i, id) => [...(messages.get(id) ?? [])],
    exportMarkdown: async () => "# md",
    async *send(_i, id, body, signal) {
      sent.push(body);
      signals.push(signal);
      const list = messages.get(id) ?? [];
      list.push({
        id: list.length + 1,
        seq: list.length + 1,
        role: "user",
        kind: body.kind,
        content: body.kind === "text" ? { text: body.text } : { question: body.question },
        created_at: "t",
      });
      let answer = "";
      for (const e of script) {
        if (hold && e.type === "done") await hold;
        if (signal.aborted) break;
        if (e.type === "text_delta") answer += e.text;
        yield e;
      }
      list.push({
        id: list.length + 1,
        seq: list.length + 1,
        role: "assistant",
        kind: "assistant",
        content: { answer, blocks: [], duration_ms: 1, stopped: signal.aborted },
        created_at: "t",
      });
    },
    async *regenerate(_i, id, signal) {
      const list = messages.get(id) ?? [];
      if (list.at(-1)?.role === "assistant") list.pop();
      signals.push(signal);
      yield { type: "text_delta", text: "again" } as ChatEvent;
      list.push({
        id: 99,
        seq: list.length + 1,
        role: "assistant",
        kind: "assistant",
        content: { answer: "again", blocks: [], duration_ms: 1, stopped: false },
        created_at: "t",
      });
    },
  };
  return { api, sent, signals, messages };
}

const SCRIPT: ChatEvent[] = [
  { type: "thinking_delta", text: "hm" },
  { type: "text_delta", text: "Hello" },
  { type: "done", duration_ms: 5 },
];

test("sending creates a conversation, streams the answer and ends with stored messages", async () => {
  const { api, sent } = fakeApi(SCRIPT);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.send({ kind: "text", text: "Hi there" }));
  expect(sent).toHaveLength(1);
  expect(result.current.conversations[0]?.title).toBe("Hi there");
  expect(result.current.assistant).toBeNull();
  expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
});

test("the answer is available while streaming", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { api } = fakeApi(SCRIPT, hold);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.send({ kind: "text", text: "Hi" });
  });
  await waitFor(() => expect(result.current.assistant?.answer).toBe("Hello"));
  expect(result.current.assistant?.thinkingOpen).toBe(false);
  expect(result.current.streaming).toBe(true);
  release();
  await act(() => pending);
  expect(result.current.streaming).toBe(false);
});

test("stop aborts the request and keeps the partial answer", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { api, signals } = fakeApi(SCRIPT, hold);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.send({ kind: "text", text: "Hi" });
  });
  await waitFor(() => expect(result.current.assistant?.answer).toBe("Hello"));
  act(() => result.current.stop());
  expect(signals[0]?.aborted).toBe(true);
  release();
  await act(() => pending);
  expect(result.current.messages.at(-1)?.content).toMatchObject({ answer: "Hello", stopped: true });
});

test("a second send while streaming is ignored", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { api, sent } = fakeApi(SCRIPT, hold);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.send({ kind: "text", text: "one" });
  });
  await waitFor(() => expect(result.current.streaming).toBe(true));
  await act(() => result.current.send({ kind: "text", text: "two" }));
  expect(sent).toHaveLength(1);
  release();
  await act(() => pending);
});

test("regenerate replaces the last answer", async () => {
  const { api } = fakeApi(SCRIPT);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.send({ kind: "text", text: "Hi" }));
  await act(() => result.current.regenerate());
  const last = result.current.messages.at(-1);
  expect(last?.content).toMatchObject({ answer: "again" });
  expect(result.current.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
});

test("regenerate also drops the quiz card and notice that follow the answer, while it streams", async () => {
  const { api, messages } = fakeApi(SCRIPT);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.send({ kind: "text", text: "Hi" }));
  const id = result.current.current?.id as number;
  const list = messages.get(id) ?? [];
  list.push(
    { id: 50, seq: 3, role: "system", kind: "quiz", content: {}, created_at: "t" },
    { id: 51, seq: 4, role: "system", kind: "notice", content: { text: "x" }, created_at: "t" },
  );
  await act(() => result.current.select(id));
  expect(result.current.messages).toHaveLength(4);
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const base = api.regenerate;
  api.regenerate = async function* (i, c, signal) {
    await hold;
    yield* base(i, c, signal);
  };
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.regenerate();
  });
  await waitFor(() => expect(result.current.messages.map((m) => m.kind)).toEqual(["text"]));
  release();
  await act(() => pending);
});

test("switching conversation loads its messages", async () => {
  const { api, messages } = fakeApi(SCRIPT);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.send({ kind: "text", text: "first" }));
  const firstId = result.current.current?.id as number;
  await act(() => result.current.create());
  expect(result.current.messages).toEqual([]);
  await act(() => result.current.select(firstId));
  expect(result.current.messages.length).toBe(messages.get(firstId)?.length);
  expect(result.current.messages.length).toBeGreaterThan(0);
});

test("rename and remove update the list", async () => {
  const { api } = fakeApi(SCRIPT);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.create());
  const id = result.current.current?.id as number;
  await act(() => result.current.rename(id, "Renamed"));
  expect(result.current.conversations[0]?.title).toBe("Renamed");
  await act(() => result.current.remove(id));
  expect(result.current.conversations).toEqual([]);
  expect(result.current.current).toBeNull();
});

test("API errors set error without throwing", async () => {
  const { api } = fakeApi();
  api.listConversations = async () => {
    throw new Error("down");
  };
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.error).toBe(true));
  await act(() => result.current.send({ kind: "text", text: "x" }));
  expect(result.current.streaming).toBe(false);
});

test("after Stop the partial answer stays until the server has stored it", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { api } = fakeApi(SCRIPT, hold);
  const base = api.messages;
  let hide = 0;
  api.messages = async (item, id) => {
    const all = await base(item, id);
    if (hide > 0 && all.at(-1)?.role === "assistant") {
      hide--;
      return all.slice(0, -1);
    }
    return all;
  };
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.send({ kind: "text", text: "Hi" });
  });
  await waitFor(() => expect(result.current.assistant?.answer).toBe("Hello"));
  act(() => result.current.stop());
  hide = 2; // the server answers "not stored yet" twice
  release();
  await act(() => pending);
  expect(result.current.assistant).toBeNull();
  expect(result.current.messages.at(-1)?.role).toBe("assistant");
  expect(result.current.messages.at(-1)?.content).toMatchObject({ stopped: true });
});

test("switching, creating or deleting a conversation is ignored while an answer streams", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { api } = fakeApi(SCRIPT, hold);
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.create());
  const first = result.current.current?.id as number;
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.send({ kind: "text", text: "Hi" });
  });
  await waitFor(() => expect(result.current.streaming).toBe(true));
  await act(() => result.current.create());
  await act(() => result.current.select(999));
  await act(() => result.current.remove(first));
  expect(result.current.conversations).toHaveLength(1);
  expect(result.current.current?.id).toBe(first);
  release();
  await act(() => pending);
});

test("an error is cleared by the next successful action", async () => {
  const { api } = fakeApi(SCRIPT);
  const make = api.createConversation;
  let fail = true;
  api.createConversation = async (item, title) => {
    if (fail) throw new Error("down");
    return make(item, title);
  };
  const { result } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(() => result.current.create());
  expect(result.current.error).toBe(true);
  fail = false;
  await act(() => result.current.create());
  expect(result.current.error).toBe(false);
});

test("leaving the page aborts a running answer", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { api, signals } = fakeApi(SCRIPT, hold);
  const { result, unmount } = renderHook(() => useChat("a1", api));
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => {
    void result.current.send({ kind: "text", text: "Hi" });
  });
  await waitFor(() => expect(result.current.streaming).toBe(true));
  unmount();
  expect(signals[0]?.aborted).toBe(true);
  release();
});
