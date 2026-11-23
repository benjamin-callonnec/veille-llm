import { Icon } from "../../components/Icon";
import type { Block } from "./reducer";

interface Props {
  blocks: Block[];
  open: boolean;
  working: boolean;
  /** Thinking tokens are arriving right now: the dots move (they stand still otherwise). */
  active?: boolean;
  durationMs: number | null;
  onToggle(): void;
}

/** The reasoning and tool activity of an answer: discreet, no box, foldable at any time. */
export function Thinking({ blocks, open, working, active = false, durationMs, onToggle }: Props) {
  if (!working && blocks.length === 0) return null;
  const seconds = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  const label = working ? "Thinking" : `Thought for ${seconds}s`;
  return (
    <div className="thinking">
      <div className="thinking-head">
        <button type="button" className="thinking-toggle" aria-expanded={open} onClick={onToggle}>
          {working && (
            <span className={active ? "thinking-dots moving" : "thinking-dots"} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
          {label}
          <span className="chevron">
            <Icon name="chevron" size={14} />
          </span>
        </button>
      </div>
      {open && (
        <div className="thinking-body">
          {blocks.map((b, i) =>
            b.type === "thinking" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks only grow
              <p key={i} className="thinking-text">
                {b.text}
              </p>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks only grow
              <div key={i} className="thinking-tool">
                <span className="tool-name">{b.name}</span>{" "}
                <span className="tool-input">{JSON.stringify(b.input)}</span>
                {b.summary !== null && <span className="tool-result"> → {b.summary}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
