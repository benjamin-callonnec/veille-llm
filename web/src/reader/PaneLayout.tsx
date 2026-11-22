import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
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

  const update = (next: PaneState) => {
    setPanes(next);
    savePanes(store, next);
  };

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
      <div className="panes-bar">
        <button type="button" onClick={() => update(togglePdf(panes))}>
          {panes.pdfCollapsed ? "Show PDF" : "Hide PDF"}
        </button>
        <button type="button" onClick={() => update(toggleChat(panes))}>
          {panes.chatCollapsed ? "Show chat" : "Hide chat"}
        </button>
      </div>
      <div className="panes-body" ref={container}>
        {!panes.pdfCollapsed && (
          <div
            className="pane pane-pdf"
            style={{ flexBasis: both ? `${panes.ratio * 100}%` : "100%" }}
          >
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
        {!panes.chatCollapsed && (
          <div
            className="pane pane-chat"
            style={{ flexBasis: both ? `${(1 - panes.ratio) * 100}%` : "100%" }}
          >
            {chat}
          </div>
        )}
      </div>
    </div>
  );
}
