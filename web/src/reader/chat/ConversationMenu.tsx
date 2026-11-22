import { useState } from "react";
import type { Conversation } from "./api";

interface Props {
  conversations: Conversation[];
  currentId: number | null;
  onSelect(id: number): void;
  onCreate(): void;
  onRename(id: number, title: string): void;
  onDelete(id: number): void;
  onExport(id: number): void;
  disabled?: boolean;
}

/** The conversation list as a dropdown in the chat header. Every action closes it. */
export function ConversationMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const current = p.conversations.find((c) => c.id === p.currentId);
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  if (p.conversations.length === 0) {
    return (
      <div className="conversations">
        <button type="button" disabled={p.disabled} onClick={p.onCreate}>
          New conversation
        </button>
      </div>
    );
  }
  return (
    <div className="conversations">
      <button
        type="button"
        disabled={p.disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {current?.title ?? "Conversations"} ▾
      </button>
      {open && (
        <ul>
          {p.conversations.map((c) => (
            <li key={c.id}>
              <button type="button" className="conv-title" onClick={act(() => p.onSelect(c.id))}>
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`Rename ${c.title}`}
                onClick={act(() => {
                  const title = window.prompt("Rename conversation", c.title)?.trim();
                  if (title) p.onRename(c.id, title);
                })}
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={`Export ${c.title}`}
                onClick={act(() => p.onExport(c.id))}
              >
                Export
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={act(() => {
                  if (window.confirm(`Delete “${c.title}”?`)) p.onDelete(c.id);
                })}
              >
                Delete
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={act(p.onCreate)}>
              New conversation
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
