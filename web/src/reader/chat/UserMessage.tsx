import type { StoredMessage } from "./api";

export function UserMessage({
  message,
  onGo,
}: {
  message: StoredMessage;
  onGo(page: number): void;
}) {
  const content = message.content as {
    text?: string;
    question?: string;
    quote?: { text: string; page: number };
  };
  return (
    <div className="user-message">
      {message.kind === "ask_agent" && content.quote && (
        <blockquote>
          <span>{content.quote.text}</span>
          <button
            type="button"
            aria-label={`Go to page ${content.quote.page}`}
            onClick={() => onGo(content.quote?.page ?? 1)}
          >
            p.{content.quote.page} ↗
          </button>
        </blockquote>
      )}
      <p>{message.kind === "ask_agent" ? content.question : content.text}</p>
    </div>
  );
}
