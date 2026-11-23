import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatApi,
  type Conversation,
  httpChatApi,
  type SendBody,
  type StoredMessage,
} from "./api";
import type { ChatEvent } from "./events";
import {
  type AssistantState,
  applyEvent,
  initialAssistant,
  stop as stopState,
  toggleThinking,
} from "./reducer";

const titleOf = (body: SendBody) =>
  (body.kind === "text" ? body.text : body.question).trim().slice(0, 50) || "New conversation";

const TRAILING = new Set(["quiz", "notice"]);

/** What regenerate drops, as the server does: the last answer and the quiz cards after it. */
function withoutLastAnswer(messages: StoredMessage[]): StoredMessage[] {
  let end = messages.length;
  while (
    end > 0 &&
    messages[end - 1]?.role === "system" &&
    TRAILING.has(messages[end - 1]?.kind ?? "")
  )
    end--;
  return messages[end - 1]?.role === "assistant" ? messages.slice(0, end - 1) : messages;
}

export function useChat(
  itemId: string,
  api: ChatApi = httpChatApi,
  clock: () => number = Date.now,
) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [assistant, setAssistant] = useState<AssistantState | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const currentRef = useRef<number | null>(null);
  currentRef.current = currentId;
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  const loadToken = useRef(0);

  const loadMessages = useCallback(
    async (id: number) => {
      const token = ++loadToken.current;
      try {
        const loaded = await api.messages(itemId, id);
        if (token === loadToken.current) setMessages(loaded);
        return loaded;
      } catch {
        setError(true);
        return [];
      }
    },
    [api, itemId],
  );

  // After Stop the server stores the partial answer a moment later: wait for it.
  const settle = useCallback(
    async (id: number) => {
      for (let i = 0; i < 10; i++) {
        const loaded = await loadMessages(id);
        if (loaded.at(-1)?.role === "assistant") return;
        await new Promise((r) => setTimeout(r, 120));
      }
    },
    [loadMessages],
  );

  useEffect(() => {
    let current = true;
    api
      .listConversations(itemId)
      .then(async (list) => {
        if (!current) return;
        setError(false);
        setConversations(list);
        const first = list[0];
        if (first) {
          setCurrentId(first.id);
          const loaded = await api.messages(itemId, first.id);
          if (current) setMessages(loaded);
        }
      })
      .catch(() => current && setError(true))
      .finally(() => current && setReady(true));
    return () => {
      current = false;
    };
  }, [api, itemId]);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (id: number, stream: AsyncIterable<ChatEvent>, ctrl: AbortController) => {
      setAssistant(initialAssistant(clock()));
      setStreaming(true);
      try {
        for await (const event of stream) {
          setAssistant((s) => (s ? applyEvent(s, event, clock()) : s));
        }
      } catch {
        if (!ctrl.signal.aborted) setError(true);
      } finally {
        if (ctrl.signal.aborted) await settle(id);
        else await loadMessages(id);
        setAssistant(null);
        setStreaming(false);
        controller.current = null;
        busy.current = false;
      }
    },
    [clock, loadMessages, settle],
  );

  const send = useCallback(
    async (body: SendBody) => {
      if (busy.current) return;
      busy.current = true;
      setError(false);
      let id = currentRef.current;
      try {
        if (id === null) {
          const made = await api.createConversation(itemId, titleOf(body));
          id = made.id;
          currentRef.current = id;
          setConversations((c) => [made, ...c]);
          setCurrentId(id);
        }
      } catch {
        setError(true);
        busy.current = false;
        return;
      }
      const ctrl = new AbortController();
      controller.current = ctrl;
      setMessages((m) => [
        ...m,
        {
          id: -1,
          seq: m.length + 1,
          role: "user",
          kind: body.kind,
          content:
            body.kind === "text"
              ? {
                  text: body.text,
                  ...(body.images?.length
                    ? {
                        images: body.images.map((i) => ({
                          id: "",
                          mime: i.mime,
                          name: i.name,
                          url: `data:${i.mime};base64,${i.data}`,
                        })),
                      }
                    : {}),
                }
              : { quote: body.quote, question: body.question },
          created_at: "",
        },
      ]);
      await run(id, api.send(itemId, id, body, ctrl.signal), ctrl);
    },
    [api, itemId, run],
  );

  const regenerate = useCallback(
    async (options?: { raiseLimit?: boolean }) => {
      const id = currentRef.current;
      if (busy.current || id === null) return;
      busy.current = true;
      setError(false);
      const ctrl = new AbortController();
      controller.current = ctrl;
      setMessages(withoutLastAnswer);
      await run(id, api.regenerate(itemId, id, ctrl.signal, options?.raiseLimit), ctrl);
    },
    [api, itemId, run],
  );

  const stop = useCallback(() => {
    controller.current?.abort();
    setAssistant((s) => (s ? stopState(s, clock()) : s));
  }, [clock]);

  const select = useCallback(
    async (id: number) => {
      if (busy.current) return;
      setError(false);
      setCurrentId(id);
      currentRef.current = id;
      await loadMessages(id);
    },
    [loadMessages],
  );

  const create = useCallback(async (): Promise<number | null> => {
    if (busy.current) return null;
    try {
      setError(false);
      const made = await api.createConversation(itemId, "New conversation");
      setConversations((c) => [made, ...c]);
      setCurrentId(made.id);
      currentRef.current = made.id;
      setMessages([]);
      return made.id;
    } catch {
      setError(true);
      return null;
    }
  }, [api, itemId]);

  /** Load the current conversation again (a card was added by another route). */
  const refresh = useCallback(async () => {
    if (currentRef.current !== null) await loadMessages(currentRef.current);
  }, [loadMessages]);

  const rename = useCallback(
    async (id: number, title: string) => {
      try {
        await api.renameConversation(itemId, id, title);
        setConversations((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
      } catch {
        setError(true);
      }
    },
    [api, itemId],
  );

  const remove = useCallback(
    async (id: number) => {
      if (busy.current) return;
      try {
        await api.deleteConversation(itemId, id);
        setError(false);
      } catch {
        setError(true);
        return;
      }
      const rest = conversationsRef.current.filter((x) => x.id !== id);
      setConversations(rest);
      if (currentRef.current === id) {
        const next = rest[0] ?? null;
        setCurrentId(next?.id ?? null);
        currentRef.current = next?.id ?? null;
        if (next) await loadMessages(next.id);
        else setMessages([]);
      }
    },
    [api, itemId, loadMessages],
  );

  const exportMarkdown = useCallback((id: number) => api.exportMarkdown(itemId, id), [api, itemId]);

  const toggle = useCallback(() => setAssistant((s) => (s ? toggleThinking(s) : s)), []);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  return {
    conversations,
    current,
    messages,
    assistant,
    streaming,
    error,
    ready,
    itemId,
    send,
    stop,
    regenerate,
    select,
    create,
    rename,
    remove,
    exportMarkdown,
    refresh,
    toggleThinking: toggle,
  };
}
