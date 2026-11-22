import { useState } from "react";
import { timeAgo } from "../../lib/time";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";
import type { AssistantState, Block } from "./reducer";
import { Thinking } from "./Thinking";

interface BodyProps {
  blocks: Block[];
  answer: string;
  open: boolean;
  working: boolean;
  durationMs: number | null;
  error?: { kind: string; message: string };
  stopped: boolean;
  onToggle(): void;
  onCite?(page: number): void;
  /** Shown as a quiet row of icons on hover, only for a finished answer that has text. */
  actions?: { text: string; time: string };
}

function Body(p: BodyProps) {
  return (
    <div className="turn turn-assistant">
      <div className="assistant">
        <Thinking
          blocks={p.blocks}
          open={p.open}
          working={p.working}
          durationMs={p.durationMs}
          onToggle={p.onToggle}
        />
        {p.answer && <Markdown text={p.answer} onCite={p.onCite} />}
        {p.stopped && <p className="muted">Stopped.</p>}
        {p.error && (
          <p role="alert" className="chat-error">
            {p.error.kind === "limit"
              ? "The subscription limit was reached. Try again later."
              : p.error.message}
          </p>
        )}
      </div>
      {p.actions && (
        <div className="msg-actions">
          <CopyButton text={p.actions.text} />
          {p.actions.time && <span className="msg-time">{p.actions.time}</span>}
        </div>
      )}
    </div>
  );
}

/** An answer still being produced: the open state comes from the stream reducer. */
export function AssistantMessage({
  state,
  onToggleThinking,
  onCite,
}: {
  state: AssistantState;
  onToggleThinking(): void;
  onCite?(page: number): void;
}) {
  return (
    <Body
      blocks={state.blocks}
      answer={state.answer}
      open={state.thinkingOpen}
      working={state.status === "streaming"}
      durationMs={state.durationMs}
      error={state.error}
      stopped={state.status === "stopped"}
      onToggle={onToggleThinking}
      onCite={onCite}
    />
  );
}

export interface StoredAssistant {
  answer?: string;
  blocks?: Block[];
  duration_ms?: number;
  stopped?: boolean;
  error?: { kind: string; message: string };
}

/** An answer read from history: thinking starts folded and can be reopened. */
export function StoredAssistantMessage({
  content,
  createdAt = "",
  now,
  onCite,
}: {
  content: StoredAssistant;
  createdAt?: string;
  now?: number;
  onCite?(page: number): void;
}) {
  const [open, setOpen] = useState(false);
  const answer = content.answer ?? "";
  return (
    <Body
      blocks={content.blocks ?? []}
      answer={answer}
      open={open}
      working={false}
      durationMs={content.duration_ms ?? null}
      error={content.error}
      stopped={content.stopped === true}
      onToggle={() => setOpen(!open)}
      onCite={onCite}
      actions={answer ? { text: answer, time: timeAgo(createdAt, now) } : undefined}
    />
  );
}
