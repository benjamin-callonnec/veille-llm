import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { combo, isMac, modifierPressed } from "../lib/platform";
import {
  clampRatio,
  loadPanes,
  nudge,
  type PaneState,
  savePanes,
  toggleChat,
  togglePdf,
} from "./lib/panes";

interface Props {
  pdf: ReactNode;
  chat: ReactNode;
  storage?: Storage | null;
  /** Which keyboard the shortcuts are for; detected from the browser by default. */
  platform?: "mac" | "other";
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Two resizable, collapsible panes: PDF on the left, chat on the right. */
export function PaneLayout({ pdf, chat, storage, platform }: Props) {
  const mac = platform ? platform === "mac" : isMac();
  const store = storage === undefined ? defaultStorage() : storage;
  const [panes, setPanes] = useState<PaneState>(() => loadPanes(store));
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const latest = useRef(panes);
  latest.current = panes;

  const update = (next: PaneState) => {
    setPanes(next);
    savePanes(store, next);
  };

  // Cmd/Ctrl+B toggles the PDF pane, Cmd/Ctrl+J the chat pane (never both collapsed). B and J are
  // not taken by Chrome; the variants with Shift or Alt are, so they are left alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handler reads the latest state through a ref
  useEffect(() => {
    const onShortcut = (e: globalThis.KeyboardEvent) => {
      if (!modifierPressed(e, mac)) return;
      if (e.code === "KeyB") update(togglePdf(latest.current));
      else if (e.code === "KeyJ") update(toggleChat(latest.current));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") update(nudge(panes, -0.02));
    else if (e.key === "ArrowRight") update(nudge(panes, 0.02));
    else return;
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || !container.current) return;
    const box = container.current.getBoundingClientRect();
    if (box.width <= 0) return;
    setPanes((s) => ({ ...s, ratio: clampRatio((e.clientX - box.left) / box.width) }));
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    savePanes(store, panes);
  };

  const both = !panes.pdfCollapsed && !panes.chatCollapsed;
  return (
    <div className="panes">
      <div className="panes-body" ref={container}>
        {panes.pdfCollapsed ? (
          <Rail
            label="Expand PDF"
            shortcut={combo(["Mod", "B"], mac)}
            onClick={() => update(togglePdf(panes))}
          />
        ) : (
          <div
            className="pane pane-pdf"
            style={{ flexBasis: both ? `${panes.ratio * 100}%` : "100%" }}
          >
            <Cross
              label="Collapse PDF"
              shortcut={combo(["Mod", "B"], mac)}
              onClick={() => update(togglePdf(panes))}
            />
            {pdf}
          </div>
        )}
        {both && (
          // biome-ignore lint/a11y/useSemanticElements: a draggable splitter is a focusable separator
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            aria-valuemin={25}
            aria-valuemax={80}
            aria-valuenow={Math.round(panes.ratio * 100)}
            tabIndex={0}
            className="pane-handle"
            onKeyDown={onKey}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setDragging(true);
            }}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        )}
        {panes.chatCollapsed ? (
          <Rail
            label="Expand chat"
            shortcut={combo(["Mod", "J"], mac)}
            onClick={() => update(toggleChat(panes))}
          />
        ) : (
          <div
            className="pane pane-chat"
            style={{ flexBasis: both ? `${(1 - panes.ratio) * 100}%` : "100%" }}
          >
            <Cross
              label="Collapse chat"
              shortcut={combo(["Mod", "J"], mac)}
              onClick={() => update(toggleChat(panes))}
            />
            {chat}
          </div>
        )}
      </div>
    </div>
  );
}

/** A discreet cross in the corner of a pane. */
function Cross({ label, shortcut, onClick }: { label: string; shortcut: string; onClick(): void }) {
  return (
    <button
      type="button"
      className="pane-cross"
      aria-label={label}
      title={`${label} (${shortcut})`}
      onClick={onClick}
    >
      ×
    </button>
  );
}

/** What stays of a collapsed pane: a thin rail with a discreet control to bring it back. */
function Rail({ label, shortcut, onClick }: { label: string; shortcut: string; onClick(): void }) {
  return (
    <div className="pane-rail">
      <button
        type="button"
        className="pane-cross"
        aria-label={label}
        title={`${label} (${shortcut})`}
        onClick={onClick}
      >
        +
      </button>
    </div>
  );
}
