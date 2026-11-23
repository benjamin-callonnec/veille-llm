import { useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../components/Icon";
import { placeBox } from "./lib/place";
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

/**
 * The box next to a selected passage, one quiet pill like the chat composer: three colour dots to
 * highlight, the question, a copy icon, and a send icon once there is something to send.
 */
export function SelectionBox({ anchor, onAsk, onHighlight, onCopy, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 340, height: 48 });
  const text = question.trim();

  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0)
      setSize({ width: rect.width, height: rect.height });
  }, []);

  const { left, top } = placeBox(anchor, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the box from inside it
    <div
      className="selection-box"
      ref={box}
      style={{ left, top }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="selection-dots">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Highlight ${c}`}
            title={`Highlight ${c}`}
            className={`dot hl-${c}`}
            onClick={() => onHighlight(c)}
          />
        ))}
      </div>
      <input
        // biome-ignore lint/a11y/noAutofocus: the box exists only to type a question
        autoFocus
        type="text"
        aria-label="Question about this passage"
        placeholder="Ask about this passage…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text) onAsk(text);
        }}
      />
      <IconButton icon="copy" label="Copy" onClick={onCopy} />
      {text && <IconButton icon="send" label="Send" onClick={() => onAsk(text)} />}
    </div>
  );
}
