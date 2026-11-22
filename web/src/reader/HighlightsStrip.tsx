import { useState } from "react";
import type { Highlight } from "./useHighlights";

interface Props {
  highlights: Highlight[];
  onGo(page: number): void;
  onRemove(id: number): void;
}

export function HighlightsStrip({ highlights, onGo, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const colors = [...new Set(highlights.map((h) => h.color))];
  const shown = filter ? highlights.filter((h) => h.color === filter) : highlights;
  return (
    <div className="highlights-strip">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Highlights ({highlights.length})
      </button>
      {open && (
        <>
          <div className="highlight-filters">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Show ${c}`}
                aria-pressed={filter === c}
                className={`dot hl-${c}`}
                onClick={() => setFilter(filter === c ? null : c)}
              />
            ))}
          </div>
          <ul>
            {shown.map((h) => (
              <li key={h.id}>
                <button type="button" className={`hl-${h.color}`} onClick={() => onGo(h.page)}>
                  p.{h.page} {h.text}
                </button>
                <button type="button" aria-label="Delete highlight" onClick={() => onRemove(h.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
