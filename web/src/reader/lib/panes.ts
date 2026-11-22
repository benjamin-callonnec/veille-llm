export interface PaneState {
  ratio: number;
  pdfCollapsed: boolean;
  chatCollapsed: boolean;
}

export const DEFAULT_PANES: PaneState = { ratio: 0.6, pdfCollapsed: false, chatCollapsed: false };
const KEY = "veille-reader-panes";

export function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_PANES.ratio;
  return Math.min(0.8, Math.max(0.25, r));
}

export const togglePdf = (s: PaneState): PaneState =>
  s.pdfCollapsed
    ? { ...s, pdfCollapsed: false }
    : { ...s, pdfCollapsed: true, chatCollapsed: false };

export const toggleChat = (s: PaneState): PaneState =>
  s.chatCollapsed
    ? { ...s, chatCollapsed: false }
    : { ...s, chatCollapsed: true, pdfCollapsed: false };

export const nudge = (s: PaneState, delta: number): PaneState => ({
  ...s,
  ratio: clampRatio(s.ratio + delta),
});

export function loadPanes(storage: Pick<Storage, "getItem"> | null): PaneState {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_PANES;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return DEFAULT_PANES;
    const r = v as Record<string, unknown>;
    const state: PaneState = {
      ratio: clampRatio(typeof r.ratio === "number" ? r.ratio : Number.NaN),
      pdfCollapsed: r.pdfCollapsed === true,
      chatCollapsed: r.chatCollapsed === true,
    };
    return state.pdfCollapsed && state.chatCollapsed ? { ...state, chatCollapsed: false } : state;
  } catch {
    return DEFAULT_PANES;
  }
}

export function savePanes(storage: Pick<Storage, "setItem"> | null, s: PaneState): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: the layout is simply not remembered
  }
}
