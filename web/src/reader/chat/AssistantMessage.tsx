import { useState } from "react";
import { IconButton } from "../../components/Icon";
import { timeAgo } from "../../lib/time";
import { stripQuizMarker } from "../lib/quiz";
import { ReadAloudButton } from "../voice/ReadAloudButton";
import { defaultSynth } from "../voice/useReadAloud";
import { AskCard, type AskCardData } from "./AskCard";
import { CopyButton } from "./CopyButton";
import { type Citation, type OnCite, toCitations } from "./events";
import { Markdown } from "./Markdown";
import type { AssistantState, Block, NoteLine } from "./reducer";
import { Thinking } from "./Thinking";

interface BodyProps {
  blocks: Block[];
  answer: string;
  open: boolean;
  working: boolean;
  durationMs: number | null;
  error?: { kind: string; message: string; raisable?: boolean };
  stopped: boolean;
  citations?: Citation[];
  /** Questions of the tutor still shown with the answer being produced. */
  asks?: AskCardData[];
  notes?: NoteLine[];
  onAnswerAsk?(id: string, text: string): Promise<void>;
  /** Read the answer aloud as it comes (the question was dictated). */
  autoRead?: boolean;
  /** Continue with the raised limit (only offered when the refusal says it can be raised). */
  onRaise?(): void;
  onToggle(): void;
  onCite?: OnCite;
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
        {p.notes?.map((n, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines only grow
          <p key={i} className="memory-line">
            {n.action === "saved"
              ? `The tutor saved a note: ${n.text}`
              : "The tutor removed a note."}
          </p>
        ))}
        {p.asks?.map((a) => (
          <AskCard
            key={a.id}
            card={a}
            onAnswer={
              p.onAnswerAsk ? (text) => p.onAnswerAsk?.(a.id, text) ?? Promise.resolve() : undefined
            }
          />
        ))}
        {p.answer && (
          <Markdown text={stripQuizMarker(p.answer)} citations={p.citations} onCite={p.onCite} />
        )}
        {p.stopped && <p className="muted">Stopped.</p>}
        {p.error && (
          <p role="alert" className="chat-error">
            {p.error.kind === "limit"
              ? "The subscription limit was reached. Try again later."
              : p.error.message}
            {p.error.raisable && p.onRaise && (
              <IconButton
                icon="raise"
                label="Continue with a raised limit"
                className="raise-limit"
                onClick={p.onRaise}
              />
            )}
          </p>
        )}
      </div>
      {(p.actions || (p.answer && defaultSynth())) && (
        <div className="msg-actions">
          {p.actions && <CopyButton text={p.actions.text} />}
          {p.answer && <ReadAloudButton text={p.answer} streaming={p.working} auto={p.autoRead} />}
          {p.actions?.time && <span className="msg-time">{p.actions.time}</span>}
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
  onAnswerAsk,
  autoRead,
}: {
  state: AssistantState;
  onToggleThinking(): void;
  onCite?: OnCite;
  onAnswerAsk?(id: string, text: string): Promise<void>;
  autoRead?: boolean;
}) {
  return (
    <Body
      autoRead={autoRead}
      blocks={state.blocks}
      answer={state.answer}
      open={state.thinkingOpen}
      working={state.status === "streaming"}
      durationMs={state.durationMs}
      error={state.error}
      stopped={state.status === "stopped"}
      citations={state.citations}
      asks={state.asks}
      notes={state.notes}
      onAnswerAsk={onAnswerAsk}
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
  citations?: Citation[];
  error?: { kind: string; message: string; raisable?: boolean };
}

/** An answer read from history: thinking starts folded and can be reopened. */
export function StoredAssistantMessage({
  content,
  createdAt = "",
  now,
  onCite,
  onRaise,
}: {
  content: StoredAssistant;
  createdAt?: string;
  now?: number;
  onCite?: OnCite;
  onRaise?(): void;
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
      citations={toCitations(content.citations)}
      onToggle={() => setOpen(!open)}
      onCite={onCite}
      onRaise={onRaise}
      actions={answer ? { text: answer, time: timeAgo(createdAt, now) } : undefined}
    />
  );
}
