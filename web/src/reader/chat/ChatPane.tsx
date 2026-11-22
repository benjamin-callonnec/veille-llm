import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { placeholders } from "../lib/placeholders";
import { AssistantMessage, StoredAssistantMessage } from "./AssistantMessage";
import { toPayload } from "./attachments";
import { Composer } from "./Composer";
import { ConversationMenu } from "./ConversationMenu";
import { toSuggestions } from "./events";
import { QuizCard } from "./QuizCard";
import { httpQuizApi, type QuizApi } from "./quizApi";
import { UserMessage } from "./UserMessage";
import type { useChat } from "./useChat";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ChatPane({
  chat,
  onGo,
  onCite = (page) => onGo(page),
  model,
  itemId = "",
  quizApi = httpQuizApi,
}: {
  chat: ReturnType<typeof useChat>;
  /** The quote arrow of a user message. */
  onGo(page: number): void;
  /** A citation chip of an answer, with the quote it carries (default: just go to the page). */
  onCite?(page: number, quote?: string): void;
  /** The model that answers, shown quietly under the composer. */
  model?: string;
  /** The paper, for the quiz routes. */
  itemId?: string;
  quizApi?: QuizApi;
}) {
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState(false);
  async function startQuiz() {
    setQuizBusy(true);
    setQuizError(false);
    try {
      const id = chat.current?.id ?? (await chat.create());
      if (id === null) return;
      await quizApi.start(itemId, id);
      await chat.refresh();
    } catch {
      setQuizError(true);
    } finally {
      setQuizBusy(false);
    }
  }

  const feed = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when content grows
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.assistant?.answer, chat.assistant?.blocks.length]);

  const [dirty, setDirty] = useState(false);
  const [fill, setFill] = useState<{ text: string; n: number } | null>(null);
  const send = async (text: string, files: File[] = []) => {
    const images = await Promise.all(files.map(toPayload));
    await chat.send({ kind: "text", text, ...(images.length ? { images } : {}) });
  };
  // the follow-up questions of the last answer, until you type or send something
  const last = chat.messages.at(-1);
  const suggestions =
    last?.role === "assistant" && !chat.streaming && !dirty
      ? toSuggestions(last.content.suggestions)
      : [];
  const pick = (prompt: string) => {
    if (placeholders(prompt).length > 0) setFill({ text: prompt, n: (fill?.n ?? 0) + 1 });
    else void send(prompt);
  };

  const lastUser = chat.messages.map((m) => m.role).lastIndexOf("user");
  return (
    <div className="chat">
      <div className="chat-tools">
        <IconButton
          icon="compose"
          label="New conversation"
          disabled={chat.streaming}
          onClick={chat.create}
          size={18}
        />
        <IconButton
          icon="quiz"
          label="Quiz me"
          disabled={chat.streaming || quizBusy || !itemId}
          onClick={startQuiz}
          size={18}
        />
        <ConversationMenu
          disabled={chat.streaming}
          conversations={chat.conversations}
          currentId={chat.current?.id ?? null}
          onSelect={chat.select}
          onRename={chat.rename}
          onDelete={chat.remove}
          onExport={async (id) => {
            const text = await chat.exportMarkdown(id);
            download(
              `${chat.conversations.find((c) => c.id === id)?.title ?? "conversation"}.md`,
              text,
            );
          }}
        />
      </div>
      <div className="chat-feed" ref={feed}>
        {chat.messages.length === 0 && !chat.assistant && (
          <p className="muted chat-empty">
            Select a passage in the PDF to ask about it, or type a question below.
          </p>
        )}
        {chat.messages.map((m, i) =>
          m.kind === "quiz" ? (
            <QuizCard
              key={`${m.id}-${m.seq}`}
              itemId={itemId}
              content={m.content}
              api={quizApi}
              onCite={onCite}
            />
          ) : m.role === "system" ? (
            <p key={`${m.id}-${m.seq}`} className="compaction-note">
              Earlier messages were summarised to keep the conversation light.
            </p>
          ) : m.role === "user" ? (
            <UserMessage
              key={`${m.id}-${m.seq}`}
              message={m}
              itemId={chat.itemId}
              onGo={onGo}
              onRetry={i === lastUser && !chat.streaming ? chat.regenerate : undefined}
            />
          ) : (
            <StoredAssistantMessage
              key={`${m.id}-${m.seq}`}
              content={m.content}
              createdAt={m.created_at}
              onCite={onCite}
            />
          ),
        )}
        {chat.assistant && (
          <AssistantMessage
            state={chat.assistant}
            onToggleThinking={chat.toggleThinking}
            onCite={onCite}
          />
        )}
        {suggestions.length > 0 && (
          <ul className="suggestions" aria-label="Suggested questions">
            {suggestions.map((q) => (
              <li key={q}>
                <button type="button" className="suggestion" onClick={() => pick(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
        {quizBusy && <p className="muted chat-empty">Writing a question from the paper…</p>}
        {quizError && (
          <p role="alert" className="chat-error">
            The quiz could not be made. Try again.
          </p>
        )}
        {chat.error && (
          <p role="alert" className="chat-error">
            Something went wrong with the chat.
          </p>
        )}
      </div>
      <Composer
        streaming={chat.streaming}
        model={model}
        onStop={chat.stop}
        draftKey={chat.current ? `c${chat.current.id}` : "new"}
        fill={fill}
        onDirty={setDirty}
        onSend={(text, files) => void send(text, files)}
      />
    </div>
  );
}
