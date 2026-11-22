import type { Block } from "./reducer";

interface Props {
  blocks: Block[];
  open: boolean;
  working: boolean;
  durationMs: number | null;
  onToggle(): void;
}

/** The reasoning and tool activity of an answer: discreet, no box, foldable at any time. */
export function Thinking({ blocks, open, working, durationMs, onToggle }: Props) {
  if (!working && blocks.length === 0) return null;
  const seconds = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  const label = working ? "Thinking" : `Thought for ${seconds}s`;
  return (
    <div className="thinking">
      <button type="button" className="thinking-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>{" "}
        {label}
      </button>
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
