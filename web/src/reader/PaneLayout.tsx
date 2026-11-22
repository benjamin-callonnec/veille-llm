import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
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
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Two resizable, collapsible panes: PDF on the left, chat on the right. */
export function PaneLayout({ pdf, chat, storage }: Props) {
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

  // Alt+1 toggles the PDF pane, Alt+2 the chat pane (never both collapsed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handler reads the latest state through a ref
  useEffect(() => {
    const onShortcut = (e: globalThis.KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "Digit1") update(togglePdf(latest.current));
      else if (e.code === "Digit2") update(toggleChat(latest.current));
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
          <Rail label="Expand PDF" shortcut="Alt+1" onClick={() => update(togglePdf(panes))} />
        ) : (
          <div
            className="pane pane-pdf"
            style={{ flexBasis: both ? `${panes.ratio * 100}%` : "100%" }}
          >
            <Cross label="Collapse PDF" shortcut="Alt+1" onClick={() => update(togglePdf(panes))} />
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
          <Rail label="Expand chat" shortcut="Alt+2" onClick={() => update(toggleChat(panes))} />
        ) : (
          <div
            className="pane pane-chat"
            style={{ flexBasis: both ? `${(1 - panes.ratio) * 100}%` : "100%" }}
          >
            <Cross
              label="Collapse chat"
              shortcut="Alt+2"
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
