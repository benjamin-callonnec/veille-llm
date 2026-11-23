import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { placeholders } from "../lib/placeholders";
import { AskCard, toAsk } from "./AskCard";
import { AssistantMessage, StoredAssistantMessage } from "./AssistantMessage";
import { type AskApi, httpAskApi } from "./askApi";
import { toPayload } from "./attachments";
import { CompactionNote } from "./CompactionNote";
import { Composer } from "./Composer";
import { ConversationMenu } from "./ConversationMenu";
import { toSuggestions } from "./events";
import { QuizCard } from "./QuizCard";
import { httpQuizApi, type QuizApi } from "./quizApi";
import { SessionTools } from "./SessionTools";
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
  itemId: itemProp = "",
  quizApi = httpQuizApi,
  askApi = httpAskApi,
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
  askApi?: AskApi;
}) {
  // the paper is the chat's own: the prop is only an override (a card must never post with no id)
  const itemId = itemProp || chat.itemId;
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  async function startQuiz() {
    setQuizBusy(true);
    setQuizError(false);
    try {
      const id = chat.current?.id ?? (await chat.create());
      if (id === null) return;
      await quizApi.start(itemId, id, "", "any");
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
  }, [
    chat.messages.length,
    chat.assistant?.answer,
    chat.assistant?.blocks.length,
    chat.assistant?.asks?.length,
  ]);

  const [dirty, setDirty] = useState(false);
  const [fill, setFill] = useState<{ text: string; n: number } | null>(null);
  // the answer to a dictated message is read aloud, the answer to a typed one is not
  const [voiceReply, setVoiceReply] = useState(false);
  const send = async (text: string, files: File[] = [], voice = false) => {
    setVoiceReply(voice);
    setAttachError(null);
    let images: Awaited<ReturnType<typeof toPayload>>[];
    try {
      images = await Promise.all(files.map(toPayload));
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "An image could not be sent.");
      return;
    }
    await chat.send({ kind: "text", text, ...(images.length ? { images } : {}) });
  };
  // the follow-up questions of the last answer, until you type or send something or a quiz starts
  const last = chat.messages.at(-1);
  const suggestions =
    last?.role === "assistant" && last.kind !== "quiz" && !chat.streaming && !quizBusy && !dirty
      ? toSuggestions(last.content.suggestions)
      : [];
  const pick = (prompt: string) => {
    if (placeholders(prompt).length > 0) setFill({ text: prompt, n: (fill?.n ?? 0) + 1 });
    else void send(prompt);
  };

  const answerAsk = async (askId: string, text: string) => {
    if (chat.current) await askApi.answer(itemId, chat.current.id, askId, text);
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
        <SessionTools
          itemId={itemId}
          conversation={chat.current?.id ?? null}
          version={chat.messages.length}
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
          ) : m.kind === "notice" ? (
            <p key={`${m.id}-${m.seq}`} className="compaction-note">
              {String(m.content.text ?? "")}
            </p>
          ) : m.kind === "ask" ? (
            <AskCard
              key={`${m.id}-${m.seq}`}
              card={toAsk(m.content) ?? { id: "", question: "", options: [], status: "expired" }}
              onAnswer={async (text) => {
                await answerAsk(String(m.content.id), text);
                await chat.refresh();
              }}
            />
          ) : m.kind === "memory" ? (
            <p key={`${m.id}-${m.seq}`} className="memory-line">
              {m.content.action === "saved"
                ? `The tutor saved a note: ${String(m.content.text ?? "")}`
                : "The tutor removed a note."}
            </p>
          ) : m.role === "system" ? (
            <CompactionNote key={`${m.id}-${m.seq}`} summary={String(m.content.summary ?? "")} />
          ) : m.role === "user" ? (
            <UserMessage
              key={`${m.id}-${m.seq}`}
              message={m}
              itemId={chat.itemId}
              onGo={onGo}
              onRetry={i === lastUser && !chat.streaming ? () => chat.regenerate() : undefined}
            />
          ) : (
            <StoredAssistantMessage
              key={`${m.id}-${m.seq}`}
              content={m.content}
              createdAt={m.created_at}
              onCite={onCite}
              onRaise={
                i === chat.messages.length - 1 && !chat.streaming
                  ? () => chat.regenerate({ raiseLimit: true })
                  : undefined
              }
            />
          ),
        )}
        {chat.assistant && (
          <AssistantMessage
            state={chat.assistant}
            onToggleThinking={chat.toggleThinking}
            onCite={onCite}
            onAnswerAsk={answerAsk}
            autoRead={voiceReply}
          />
        )}
        {suggestions.length > 1 && (
          <ul className="suggestions" aria-label="Suggested questions">
            {suggestions.slice(1).map((q) => (
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
        {attachError && (
          <p role="alert" className="chat-error">
            {attachError}
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
        tabFill={suggestions[0]}
        onDirty={setDirty}
        onSend={(text, files, voice) => void send(text, files, voice)}
      />
    </div>
  );
}
