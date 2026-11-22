import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface Props {
  text: string;
  onCite?(page: number): void;
}

const CITE = /\[p\.(\d+)\]/g;

function codeText(node: unknown): string {
  const code = (node as { children?: { children?: { value?: string }[] }[] } | undefined)
    ?.children?.[0];
  return (code?.children?.[0]?.value ?? "").replace(/\n$/, "");
}

/** Safe Markdown: raw HTML is text, only http(s) links, no remote images, [p.N] becomes a chip. */
export function Markdown({ text, onCite }: Props) {
  const components: Components = {
    a({ href, children }: { href?: string; children?: ReactNode }) {
      if (href?.startsWith("cite:")) {
        const page = Number(href.slice(5));
        return (
          <button type="button" className="cite" onClick={() => onCite?.(page)}>
            {children}
          </button>
        );
      }
      if (href && /^https?:\/\//i.test(href)) {
        return (
          <a href={href} rel="noopener noreferrer" target="_blank">
            {children}
          </a>
        );
      }
      return <span>{children}</span>;
    },
    img({ alt }: { alt?: string }) {
      return <span className="img-alt">{alt}</span>;
    },
    pre({ node, children }) {
      const code = codeText(node);
      return (
        <div className="code">
          <button
            type="button"
            className="copy"
            aria-label="Copy code"
            onClick={() => navigator.clipboard?.writeText(code).catch(() => {})}
          >
            Copy
          </button>
          <pre>{children}</pre>
        </div>
      );
    },
  };
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
        urlTransform={(url) => url}
        components={components}
      >
        {text.replace(CITE, (_m, n: string) => `[p.${n}](cite:${n})`)}
      </ReactMarkdown>
    </div>
  );
}
