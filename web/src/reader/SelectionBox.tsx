import { useState } from "react";
import type { Quote } from "./lib/quote";

export const COLORS = ["yellow", "green", "red"] as const;

interface Props {
  quote: Quote;
  anchor: { x: number; y: number };
  onAsk(question: string): void;
  onHighlight(color: string): void;
  onCopy(): void;
  onClose(): void;
}

/** The small box next to a selected passage: ask a question, highlight, copy. */
export function SelectionBox({ anchor, onAsk, onHighlight, onCopy, onClose }: Props) {
  const [question, setQuestion] = useState("");
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the box from inside it
    <div
      className="selection-box"
      style={{ left: anchor.x, top: anchor.y + 8 }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the box exists only to type a question
        autoFocus
        type="text"
        aria-label="Question about this passage"
        placeholder="Ask about this passage…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          const text = question.trim();
          if (e.key === "Enter" && text) onAsk(text);
        }}
      />
      <div className="selection-tools">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Highlight ${c}`}
            className={`dot hl-${c}`}
            onClick={() => onHighlight(c)}
          />
        ))}
        <button type="button" onClick={onCopy}>
          Copy
        </button>
      </div>
    </div>
  );
}
