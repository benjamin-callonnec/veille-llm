import { useState } from "react";
import { IconButton } from "../../components/Icon";

interface Props {
  onSend(text: string): void;
  onStop(): void;
  streaming: boolean;
  /** The model that answers, shown quietly under the input. */
  model?: string;
}

/**
 * One quiet pill: the text, and on the right only what applies now:
 * nothing while it is empty, a send icon once there is text, a stop icon while it answers.
 */
export function Composer({ onSend, onStop, streaming, model }: Props) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0;
  const submit = () => {
    const value = text.trim();
    if (!value || streaming) return;
    onSend(value);
    setText("");
  };
  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          aria-label="Message"
          placeholder={streaming ? "Answering…" : "Ask about the paper…"}
          rows={1}
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
          <IconButton
            icon="stop"
            label="Stop"
            className="composer-send"
            onClick={onStop}
            size={20}
          />
        ) : (
          ready && (
            <IconButton
              icon="send"
              label="Send"
              className="composer-send"
              onClick={submit}
              size={20}
            />
          )
        )}
      </div>
      {model && <p className="composer-status">{model}</p>}
    </div>
  );
}
