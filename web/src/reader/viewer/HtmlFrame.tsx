import { withCsp } from "./csp";

/** An untrusted HTML page: scripts may run, but in an opaque origin and with no network. */
export function HtmlFrame({ content, title }: { content: string; title: string }) {
  return (
    <iframe
      className="viewer-frame"
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={withCsp(content)}
      // the arrow keys work at once, without a first click into the page
      onLoad={(e) => e.currentTarget.focus()}
    />
  );
}
