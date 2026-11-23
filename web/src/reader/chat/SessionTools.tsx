import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { MemoryPanel } from "./MemoryPanel";
import { httpSessionApi, type SessionApi } from "./sessionApi";
import { TracePanel } from "./TracePanel";

type Panel = "memory" | "trace" | null;

/**
 * Two quiet icons of the chat tools: the notes the tutor keeps, and the trace of its turns.
 * Each opens a small panel under the icons; Escape or a click elsewhere closes it.
 */
export function SessionTools({
  itemId,
  conversation,
  version,
  api = httpSessionApi,
  viewer,
}: {
  itemId: string;
  conversation: number | null;
  /** Changes when a turn ends, so open panels read again. */
  version: number;
  api?: SessionApi;
  /** The reports of this paper: the icon is there only when there is one to open. */
  viewer?: { available: boolean; open: boolean; onToggle(): void };
}) {
  const [open, setOpen] = useState<Panel>(null);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onPress = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [open]);

  if (!itemId) return null;
  const toggle = (panel: Exclude<Panel, null>) => setOpen(open === panel ? null : panel);
  return (
    <span className="session-tools" ref={root}>
      <IconButton
        icon="note"
        label="Session memory"
        size={18}
        expanded={open === "memory"}
        onClick={() => toggle("memory")}
      />
      <IconButton
        icon="trace"
        label="Turn trace"
        size={18}
        expanded={open === "trace"}
        onClick={() => toggle("trace")}
      />
      {viewer?.available && (
        <IconButton
          icon="report"
          label="Reports (V)"
          size={18}
          pressed={viewer.open}
          onClick={viewer.onToggle}
        />
      )}
      {open === "memory" && <MemoryPanel itemId={itemId} api={api} version={version} />}
      {open === "trace" && (
        <TracePanel itemId={itemId} conversation={conversation} api={api} version={version} />
      )}
    </span>
  );
}
