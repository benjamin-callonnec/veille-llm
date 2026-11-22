import { useState } from "react";
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
  onRegenerate?(): void;
}

function Body(p: BodyProps) {
  return (
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
      {p.onRegenerate && !p.working && (
        <button type="button" className="regenerate" onClick={p.onRegenerate}>
          Regenerate
        </button>
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
  onCite,
  onRegenerate,
}: {
  content: StoredAssistant;
  onCite?(page: number): void;
  onRegenerate?(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Body
      blocks={content.blocks ?? []}
      answer={content.answer ?? ""}
      open={open}
      working={false}
      durationMs={content.duration_ms ?? null}
      error={content.error}
      stopped={content.stopped === true}
      onToggle={() => setOpen(!open)}
      onCite={onCite}
      onRegenerate={onRegenerate}
    />
  );
}
