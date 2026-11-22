import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import type { Conversation } from "./api";

interface Props {
  conversations: Conversation[];
  currentId: number | null;
  onSelect(id: number): void;
  onRename(id: number, title: string): void;
  onDelete(id: number): void;
  onExport(id: number): void;
  disabled?: boolean;
}

/** The conversations behind one quiet icon; every action is an icon and closes the menu. */
export function ConversationMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPress = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [open]);

  if (p.conversations.length === 0) return null;
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="conversations" ref={root}>
      <IconButton
        icon="more"
        label="Conversations"
        disabled={p.disabled}
        expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <ul>
          {p.conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="conv-title"
                aria-current={c.id === p.currentId ? "true" : undefined}
                onClick={act(() => p.onSelect(c.id))}
              >
                {c.title}
              </button>
              <IconButton
                icon="edit"
                label={`Rename ${c.title}`}
                onClick={act(() => {
                  const title = window.prompt("Rename conversation", c.title)?.trim();
                  if (title) p.onRename(c.id, title);
                })}
              />
              <IconButton
                icon="download"
                label={`Export ${c.title}`}
                onClick={act(() => p.onExport(c.id))}
              />
              <IconButton
                icon="trash"
                label={`Delete ${c.title}`}
                onClick={act(() => {
                  if (window.confirm(`Delete “${c.title}”?`)) p.onDelete(c.id);
                })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
