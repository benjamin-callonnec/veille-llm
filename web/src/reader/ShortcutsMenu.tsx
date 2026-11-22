import { useEffect, useRef, useState } from "react";

export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  entries: Shortcut[];
}

/** Every keyboard shortcut of the reader, in one place (the panel below is built from it). */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Panes",
    entries: [
      { keys: ["Alt", "1"], label: "Toggle the PDF pane" },
      { keys: ["Alt", "2"], label: "Toggle the chat pane" },
      { keys: ["←", "→"], label: "Resize the panes (on the divider)" },
    ],
  },
  {
    title: "PDF",
    entries: [
      { keys: ["PageUp"], label: "Previous page" },
      { keys: ["PageDown"], label: "Next page" },
      { keys: ["+"], label: "Zoom in" },
      { keys: ["-"], label: "Zoom out" },
      { keys: ["/"], label: "Search in the paper" },
      { keys: ["Esc"], label: "Close the search" },
    ],
  },
  {
    title: "Selected passage",
    entries: [
      { keys: ["Enter"], label: "Send the question" },
      { keys: ["Esc"], label: "Close" },
    ],
  },
  {
    title: "Chat",
    entries: [
      { keys: ["Enter"], label: "Send the message" },
      { keys: ["Shift", "Enter"], label: "New line" },
    ],
  },
  { title: "Help", entries: [{ keys: ["?"], label: "Show or hide this list" }] },
];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

/** A small gear in the bottom-right corner that lists the keyboard shortcuts. */
export function ShortcutsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "?" && !e.altKey && !e.ctrlKey && !e.metaKey && !isTyping(e.target)) {
        setOpen((o) => !o);
      }
    };
    const onPress = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, []);

  return (
    <div className="shortcuts" ref={root}>
      {open && (
        <div className="shortcuts-panel" role="dialog" aria-label="Keyboard shortcuts">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              <dl>
                {group.entries.map((entry) => (
                  <div key={entry.label} className="shortcut">
                    <dt>
                      {entry.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{entry.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="muted">Alt is Option on a Mac.</p>
        </div>
      )}
      <button
        type="button"
        className="shortcuts-gear"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>
    </div>
  );
}
