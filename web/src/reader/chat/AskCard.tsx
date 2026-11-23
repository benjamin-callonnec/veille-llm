import { useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { type AskStatus, MAX_ASK_OPTION } from "./events";

export const MAX_REPLY = 500;

export interface AskCardData {
  id: string;
  question: string;
  options: string[];
  status: AskStatus;
  answer?: string;
}

/** A well-formed stored card, or null (the stored content is checked like the stream). */
export function toAsk(raw: unknown): AskCardData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.question !== "string") return null;
  const status: AskStatus =
    r.status === "answered" || r.status === "expired" ? r.status : "pending";
  const options = Array.isArray(r.options)
    ? r.options.filter((o): o is string => typeof o === "string" && o.length <= MAX_ASK_OPTION)
    : [];
  return {
    id: r.id,
    question: r.question,
    options: options.slice(0, 4),
    status,
    ...(typeof r.answer === "string" ? { answer: r.answer } : {}),
  };
}

/**
 * The tutor paused to ask you something. Pending: pick an option or type a reply (Enter sends).
 * Afterwards the card only says how it ended; it never waits for ever (the server expires it).
 */
export function AskCard({
  card,
  onAnswer,
}: {
  card: AskCardData;
  /** Sends the reply; absent for a card that can no longer be answered. */
  onAnswer?(text: string): Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = card.status === "pending" && onAnswer !== undefined;

  async function send(reply: string) {
    const value = reply.trim();
    if (!value || sending || !onAnswer) return;
    setSending(true);
    setFailed(false);
    try {
      await onAnswer(value);
    } catch {
      setFailed(true);
      setSending(false);
    }
  }

  return (
    <section className="ask" aria-label="Question from the tutor">
      <p className="ask-question">{card.question}</p>
      {live && (
        <>
          {card.options.length > 0 && (
            <ul className="ask-options">
              {card.options.map((option) => (
                <li key={option}>
                  <button
                    type="button"
                    className="ask-option"
                    disabled={sending}
                    onClick={() => void send(option)}
                  >
                    {option}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="ask-reply">
            <input
              className="ask-input"
              type="text"
              aria-label="Your answer"
              placeholder="Or type your own answer"
              maxLength={MAX_REPLY}
              value={text}
              disabled={sending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            <IconButton
              icon="send"
              label="Send answer"
              disabled={sending || !text.trim()}
              onClick={() => void send(text)}
            />
          </div>
          {failed && (
            <p role="alert" className="chat-error ask-note">
              The answer could not be sent. Try again.
            </p>
          )}
        </>
      )}
      {card.status === "answered" && (
        <p className="ask-note">
          <Icon name="check" size={14} /> <span className="ask-given">{card.answer}</span>
        </p>
      )}
      {(card.status === "expired" || (card.status === "pending" && !live)) && (
        <p className="ask-note muted">No answer in time: the tutor carried on without one.</p>
      )}
    </section>
  );
}
