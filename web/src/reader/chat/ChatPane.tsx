import { useEffect, useRef } from "react";
import { AssistantMessage, StoredAssistantMessage } from "./AssistantMessage";
import { Composer } from "./Composer";
import { ConversationMenu } from "./ConversationMenu";
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
  model,
}: {
  chat: ReturnType<typeof useChat>;
  onGo(page: number): void;
  /** The model that answers, shown quietly under the composer. */
  model?: string;
}) {
  const feed = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when content grows
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.assistant?.answer, chat.assistant?.blocks.length]);

  const lastUser = chat.messages.map((m) => m.role).lastIndexOf("user");
  return (
    <div className="chat">
      <div className="chat-tools">
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
          m.role === "user" ? (
            <UserMessage
              key={`${m.id}-${m.seq}`}
              message={m}
              onGo={onGo}
              onRetry={i === lastUser && !chat.streaming ? chat.regenerate : undefined}
            />
          ) : (
            <StoredAssistantMessage
              key={`${m.id}-${m.seq}`}
              content={m.content}
              createdAt={m.created_at}
              onCite={onGo}
            />
          ),
        )}
        {chat.assistant && (
          <AssistantMessage
            state={chat.assistant}
            onToggleThinking={chat.toggleThinking}
            onCite={onGo}
          />
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
        onNew={chat.create}
        onSend={(text) => chat.send({ kind: "text", text })}
      />
    </div>
  );
}
