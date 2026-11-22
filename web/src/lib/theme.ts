export type Theme = "auto" | "light" | "dark";
export const THEMES: Theme[] = ["auto", "light", "dark"];
const KEY = "veille-theme";

const isTheme = (v: unknown): v is Theme =>
  typeof v === "string" && (THEMES as string[]).includes(v);

export function loadTheme(storage: Pick<Storage, "getItem"> | null): Theme {
  try {
    const raw = storage?.getItem(KEY);
    return isTheme(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function saveTheme(storage: Pick<Storage, "setItem"> | null, theme: Theme): void {
  try {
    storage?.setItem(KEY, theme);
  } catch {
    // the choice is simply not remembered
  }
}

/** "auto" follows the system appearance (no attribute); light and dark force a theme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
}

export function defaultStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Apply the remembered theme at startup. */
export function initTheme(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
  root: HTMLElement = document.documentElement,
): Theme {
  const theme = loadTheme(storage);
  applyTheme(theme, root);
  return theme;
}
