import { useState } from "react";

interface Props {
  onSend(text: string): void;
  onStop(): void;
  streaming: boolean;
}

export function Composer({ onSend, onStop, streaming }: Props) {
  const [text, setText] = useState("");
  const submit = () => {
    const value = text.trim();
    if (!value || streaming) return;
    onSend(value);
    setText("");
  };
  return (
    <div className="composer">
      <textarea
        aria-label="Message"
        placeholder="Ask about the paper…"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {streaming ? (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="button" disabled={!text.trim()} onClick={submit}>
          Send
        </button>
      )}
    </div>
  );
}
