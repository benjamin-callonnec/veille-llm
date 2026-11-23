import { useEffect, useRef } from "react";
import { KEY_BRIDGE, withCsp } from "./csp";

const KEYS = ["v", "V", "Escape"];

/** An untrusted HTML page: scripts may run, but in an opaque origin and with no network. */
export function HtmlFrame({
  content,
  title,
  onKey,
  active = true,
}: {
  content: string;
  title: string;
  /** V or Escape typed inside the page (it has the focus, so the app never sees them). */
  onKey?: (key: string) => void;
  /** Becomes true when the viewer is shown again: the page takes the keyboard back. */
  active?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(onKey);
  latest.current = onKey;

  useEffect(() => {
    if (active) frame.current?.focus();
  }, [active]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // only the page itself, only a known key: the page is untrusted
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const key = (e.data as { veilleKey?: unknown } | null)?.veilleKey;
      if (typeof key === "string" && KEYS.includes(key)) latest.current?.(key);
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
      srcDoc={withCsp(content, KEY_BRIDGE)}
      // the arrow keys work at once, without a first click into the page
      onLoad={(e) => e.currentTarget.focus()}
    />
  );
}
