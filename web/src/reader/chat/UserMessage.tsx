import { IconButton } from "../../components/Icon";
import { formatDay } from "../../lib/time";
import type { StoredMessage } from "./api";
import { CopyButton } from "./CopyButton";

interface Props {
  message: StoredMessage;
  onGo(page: number): void;
  /** Ask for another answer to this question (only offered on the last one). */
  onRetry?(): void;
}

/** Your question in a quiet bubble; its day, retry and copy appear as icons when you hover it. */
export function UserMessage({ message, onGo, onRetry }: Props) {
  const content = message.content as {
    text?: string;
    question?: string;
    quote?: { text: string; page: number };
  };
  const text = (message.kind === "ask_agent" ? content.question : content.text) ?? "";
  const day = formatDay(message.created_at);
  return (
    <div className="turn turn-user">
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
        <p>{text}</p>
      </div>
      <div className="msg-actions">
        {day && <span className="msg-time">{day}</span>}
        {onRetry && <IconButton icon="retry" label="Retry" onClick={onRetry} />}
        <CopyButton text={text} />
      </div>
    </div>
  );
}
