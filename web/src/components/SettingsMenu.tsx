import { useEffect, useRef, useState } from "react";
import type { ShortcutGroup } from "../lib/shortcuts";
import { applyTheme, defaultStorage, loadTheme, saveTheme, type Theme } from "../lib/theme";

const THEME_LABELS: Record<Theme, string> = {
  auto: "Auto (follows the system)",
  light: "Papier (light)",
  dark: "Nuit (dark)",
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

interface Props {
  shortcuts: ShortcutGroup[];
  storage?: Storage | null;
}

/** The gear fixed in the bottom-left corner of every page: theme and keyboard shortcuts. */
export function SettingsMenu({ shortcuts, storage }: Props) {
  const store = storage === undefined ? defaultStorage() : storage;
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme(store));
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

  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    saveTheme(store, next);
  };

  return (
    <div className="settings" ref={root}>
      {open && (
        <div className="settings-panel" role="dialog" aria-label="Settings">
          <fieldset>
            <legend className="sr-only">Theme</legend>
            <h2>Theme</h2>
            {(Object.keys(THEME_LABELS) as Theme[]).map((t) => (
              <label key={t} className="theme-choice">
                <input type="radio" name="theme" checked={theme === t} onChange={() => choose(t)} />
                {THEME_LABELS[t]}
              </label>
            ))}
          </fieldset>
          {shortcuts.map((group) => (
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
        className="settings-gear"
        aria-label="Settings"
        title="Settings (?)"
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
