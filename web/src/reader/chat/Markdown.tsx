import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { IconButton } from "../../components/Icon";
import { normalise } from "../lib/locate";
import type { Citation, Label, OnCite } from "./events";

interface Props {
  text: string;
  citations?: Citation[];
  onCite?: OnCite;
}

// same pattern as the server (src/veille_reader/citations.py)
const CITE =
  /\[p\.(\d+)(?:\s*[:,]?\s*(?:["“«]([^"”»\]]*)["”»]|([Ff][Ii][Gg][Uu][Rr][Ee]|[Ff][Ii][Gg]\.?|[Tt][Aa][Bb][Ll][Ee])\s*(\d{1,3}(?:\.\d{1,3})?)))?\s*\]/g;
const MAX_QUOTE = 300;
const MIN_QUOTE_CHARS = 8;

interface Cite {
  page: number;
  quote?: string;
  label?: Label;
}

const labelText = (label?: Label) => (label ? `${label.kind} ${label.number}` : "");

/** The server's verdict on a written citation: same page, same quote once normalised. */
function verdictOf(cite: Cite, citations: Citation[]): Citation | undefined {
  const wanted = normalise(cite.quote ?? "");
  const usable = wanted.length >= MIN_QUOTE_CHARS;
  return citations.find(
    (v) =>
      v.page === cite.page &&
      normalise(v.quote ?? "") === (usable ? wanted : "") &&
      (v.label ?? "") === labelText(cite.label),
  );
}

function tooltip(cite: Cite, verdict: Citation | undefined): string {
  const quote = verdict ? verdict.quote : cite.quote;
  const parts = [`p.${cite.page}`];
  if (verdict?.section) parts.push(verdict.section);
  if (quote) parts.push(`“${quote}”`);
  const base = parts.join(" · ");
  if (verdict?.status === "wrong_page" && verdict.found_page)
    return `${base} — found on p.${verdict.found_page} instead`;
  if (verdict?.status === "unverified" || verdict?.status === "invalid_page")
    return `${base} — not found in the paper`;
  return base;
}

function codeText(node: unknown): string {
  const code = (node as { children?: { children?: { value?: string }[] }[] } | undefined)
    ?.children?.[0];
  return (code?.children?.[0]?.value ?? "").replace(/\n$/, "");
}

/** Safe Markdown: raw HTML is text, only http(s) links, no remote images, [p.N] becomes a chip. */
export function Markdown({ text, citations = [], onCite }: Props) {
  const cites: Cite[] = [];
  const source = text.replace(CITE, (_m, n: string, q?: string, kind?: string, num?: string) => {
    const quote = (q ?? "").trim();
    const label: Label | undefined =
      kind && num
        ? { kind: kind.toLowerCase() === "table" ? "table" : "figure", number: num }
        : undefined;
    cites.push({
      page: Number(n),
      quote: quote && quote.length <= MAX_QUOTE ? quote : undefined,
      label,
    });
    return `[p.${n}](cite:${cites.length - 1})`;
  });
  const components: Components = {
    a({ href, children }: { href?: string; children?: ReactNode }) {
      if (href?.startsWith("cite:")) {
        const cite = cites[Number(href.slice(5))];
        if (!cite) return <span>{children}</span>;
        const verdict = verdictOf(cite, citations);
        const doubt =
          verdict?.status === "unverified" ||
          verdict?.status === "invalid_page" ||
          verdict?.status === "wrong_page";
        const page =
          verdict?.status === "wrong_page" && verdict.found_page ? verdict.found_page : cite.page;
        return (
          <button
            type="button"
            className={doubt ? "cite cite-doubt" : "cite"}
            title={tooltip(cite, verdict)}
            onClick={() => {
              if (cite.quote) onCite?.(page, cite.quote);
              else if (cite.label) onCite?.(page, undefined, cite.label);
              else onCite?.(page);
            }}
          >
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
          <IconButton
            icon="copy"
            label="Copy code"
            className="copy"
            onClick={() => navigator.clipboard?.writeText(code).catch(() => {})}
          />
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
        {source}
      </ReactMarkdown>
    </div>
  );
}
