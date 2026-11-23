import { useState } from "react";
import { Icon, IconButton } from "../components/Icon";
import type { Highlight } from "./useHighlights";

interface Props {
  highlights: Highlight[];
  onGo(page: number): void;
  onRemove(id: number): void;
}

/** The highlights of the paper: a quiet icon with the count, opening a calm list of passages. */
export function HighlightsStrip({ highlights, onGo, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const colors = [...new Set(highlights.map((h) => h.color))];
  const shown = filter ? highlights.filter((h) => h.color === filter) : highlights;
  return (
    <div className="highlights-strip">
      <div className="hl-bar">
        <button
          type="button"
          className="hl-toggle"
          aria-label={`Highlights (${highlights.length})`}
          title="Highlights"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="highlighter" size={18} />
          <span>{highlights.length}</span>
        </button>
        {open && colors.length > 1 && (
          <div className="hl-filters">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Show ${c}`}
                title={`Show ${c} only`}
                aria-pressed={filter === c}
                className={`dot hl-${c}`}
                onClick={() => setFilter(filter === c ? null : c)}
              />
            ))}
          </div>
        )}
      </div>
      {open &&
        (highlights.length === 0 ? (
          <p className="muted hl-empty">Select a passage in the PDF to highlight it.</p>
        ) : (
          <ul className="hl-list">
            {shown.map((h) => (
              <li key={h.id}>
                <span className={`hl-dot hl-${h.color}`} aria-hidden="true" />
                <button type="button" className="hl-row-text" onClick={() => onGo(h.page)}>
                  <span className="hl-page">p.{h.page}</span>
                  <span className="hl-quote">{h.text}</span>
                </button>
                <span className="hl-actions">
                  <IconButton
                    icon="copy"
                    label="Copy highlight"
                    size={16}
                    onClick={() => void navigator.clipboard?.writeText(h.text)}
                  />
                  <IconButton
                    icon="trash"
                    label="Delete highlight"
                    size={16}
                    onClick={() => onRemove(h.id)}
                  />
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
