import { IconButton } from "../../components/Icon";
import { formatDay } from "../../lib/time";
import type { Rect } from "../lib/quote";
import type { ImageRef, StoredMessage } from "./api";
import { CopyButton } from "./CopyButton";

interface Props {
  message: StoredMessage;
  /** The paper, to find the images of the message. */
  itemId?: string;
  /** Back to the page, and to the exact rects of the quote when it has them. */
  onGo(page: number, rects?: Rect[]): void;
  /** Ask for another answer to this question (only offered on the last one). */
  onRetry?(): void;
}

const MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const imageUrl = (itemId: string, id: string) =>
  `/api/items/${encodeURIComponent(itemId)}/images/${id}`;

/** Only what the server writes (a hex id, an image type) or what this page just made (data:). */
function isImage(r: unknown): r is ImageRef {
  if (typeof r !== "object" || r === null) return false;
  const i = r as Record<string, unknown>;
  if (typeof i.mime !== "string" || !MIMES.includes(i.mime)) return false;
  if (typeof i.url === "string") return i.url.startsWith(`data:${i.mime};base64,`);
  return typeof i.id === "string" && /^[0-9a-f]{64}$/.test(i.id);
}

/** Your question in a quiet bubble; its day, retry and copy appear as icons when you hover it. */
export function UserMessage({ message, itemId = "", onGo, onRetry }: Props) {
  const content = message.content as {
    text?: string;
    question?: string;
    quote?: { text: string; page: number; rects?: Rect[] };
    images?: ImageRef[];
  };
  const images = (content.images ?? []).filter(isImage);
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
              onClick={() => onGo(content.quote?.page ?? 1, content.quote?.rects)}
            >
              p.{content.quote.page} ↗
            </button>
          </blockquote>
        )}
        {images.length > 0 && (
          <ul className="message-images">
            {images.map((image, i) => {
              const href = image.url ?? imageUrl(itemId, image.id);
              const picture = <img src={href} alt={image.name ?? `Attached image ${i + 1}`} />;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, the same image can repeat
                <li key={`${image.id}-${i}`}>
                  {image.url ? (
                    picture
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {picture}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {text && <p>{text}</p>}
      </div>
      <div className="msg-actions">
        {day && <span className="msg-time">{day}</span>}
        {onRetry && <IconButton icon="retry" label="Retry" onClick={onRetry} />}
        <CopyButton text={text} />
      </div>
    </div>
  );
}
