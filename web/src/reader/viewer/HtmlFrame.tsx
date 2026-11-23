import { useEffect, useRef } from "react";
import { FRAME_BRIDGE, withCsp } from "./csp";

const KEYS = ["v", "V", "Escape"];

/** An untrusted HTML page: scripts may run, but in an opaque origin and with no network. */
export function HtmlFrame({
  content,
  title,
  onKey,
  onCite,
  active = true,
}: {
  content: string;
  title: string;
  /** V or Escape typed inside the page (it has the focus, so the app never sees them). */
  onKey?: (key: string) => void;
  /** A citation was clicked in the page (the raw message: the app validates it). */
  onCite?: (raw: unknown) => void;
  /** Becomes true when the viewer is shown again: the page takes the keyboard back. */
  active?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(onKey);
  latest.current = onKey;
  const latestCite = useRef(onCite);
  latestCite.current = onCite;

  useEffect(() => {
    if (active) frame.current?.focus();
  }, [active]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // only the page itself, only a known key: the page is untrusted
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const data = e.data as { veilleKey?: unknown; veilleCite?: unknown } | null;
      if (typeof data !== "object" || data === null) return;
      if (typeof data.veilleKey === "string" && KEYS.includes(data.veilleKey)) {
        latest.current?.(data.veilleKey);
      } else if ("veilleCite" in data) {
        latestCite.current?.(data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      className="viewer-frame"
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={withCsp(content, FRAME_BRIDGE)}
      // the arrow keys work at once, but a page that reloads behind a hidden viewer or while you
      // type elsewhere must not take the keyboard
      onLoad={(e) => {
        const typing = document.activeElement;
        const inField =
          typing instanceof HTMLElement &&
          (["INPUT", "TEXTAREA", "SELECT"].includes(typing.tagName) || typing.isContentEditable);
        if (active && !inField) e.currentTarget.focus();
      }}
    />
  );
}
