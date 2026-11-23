import { useEffect, useRef, useState } from "react";
import { isMac, isTyping, keysFor } from "../lib/platform";
import type { ShortcutGroup } from "../lib/shortcuts";
import { loadSpeed, RATES, SPEEDS, type SpeechSpeed, saveSpeed } from "../lib/speechRate";
import { applyTheme, defaultStorage, loadTheme, saveTheme, type Theme } from "../lib/theme";
import { Icon } from "./Icon";

const THEME_LABELS: Record<Theme, string> = {
  auto: "Auto (follows the system)",
  light: "Papier (light)",
  dark: "Nuit (dark)",
};

const SPEED_LABELS: Record<SpeechSpeed, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

interface Props {
  shortcuts: ShortcutGroup[];
  storage?: Storage | null;
  /** Which keyboard to show the shortcuts for; detected from the browser by default. */
  platform?: "mac" | "other";
}

/** The gear fixed in the bottom-left corner of every page: theme and keyboard shortcuts. */
export function SettingsMenu({ shortcuts, storage, platform }: Props) {
  const mac = platform ? platform === "mac" : isMac();
  const store = storage === undefined ? defaultStorage() : storage;
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme(store));
  const [speed, setSpeed] = useState<SpeechSpeed>(() => loadSpeed(store));
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

  const chooseSpeed = (next: SpeechSpeed) => {
    setSpeed(next);
    saveSpeed(store, next);
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
          {canSpeak() && (
            <fieldset>
              <legend className="sr-only">Reading speed</legend>
              <h2>Reading speed</h2>
              {SPEEDS.map((s) => (
                <label key={s} className="theme-choice">
                  <input
                    type="radio"
                    name="tts-speed"
                    value={s}
                    checked={speed === s}
                    onChange={() => chooseSpeed(s)}
                  />
                  {SPEED_LABELS[s]}
                  {s !== "normal" && <span className="muted"> ({RATES[s]}×)</span>}
                </label>
              ))}
            </fieldset>
          )}
          {shortcuts.map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              <dl>
                {group.entries.map((entry) => (
                  <div key={entry.label} className="shortcut">
                    <dt>
                      {entry.keys
                        .flatMap((k) => keysFor(k, mac))
                        .map((cap, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: a key cap can repeat in one shortcut
                          <kbd key={`${cap}-${i}`}>{cap}</kbd>
                        ))}
                    </dt>
                    <dd>{entry.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {mac && <p className="muted">⌘ is the Command key, fn the Function key.</p>}
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
        <Icon name="settings" />
      </button>
    </div>
  );
}
