import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { locateQuote } from "../lib/locate";
import type { Rect } from "../lib/quote";
import type { PdfSource } from "../pdf/source";
import { type Caption, findCaption } from "../structureApi";
import { type CiteRef, peekScrollTop } from "./peek";

const CARD_WIDTH = 420;

type State =
  | { status: "loading" }
  | { status: "ready" | "unlocated"; page: number; rects: Rect[] }
  | { status: "nopdf" | "error" };

const MESSAGES: Partial<Record<State["status"], string>> = {
  unlocated: "Passage not located",
  nopdf: "No PDF for this paper",
  error: "The preview could not be drawn",
};

interface Props {
  cite: CiteRef;
  source: PdfSource | null;
  captions: () => Promise<Caption[]>;
  /** The user wants the real PDF: go there (same jump as a citation of the chat). */
  onOpen(cite: CiteRef): void;
  onClose(): void;
}

/**
 * A glance at the paper: the whole page, scrollable, already scrolled to the cited passage, with
 * the passage highlighted.
 */
export function CitationPeek({ cite, source, captions, onOpen, onClose }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latestCaptions = useRef(captions);
  latestCaptions.current = captions;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new citation (same fields) draws again only when its parts change
  useEffect(() => {
    if (!source) {
      setState({ status: "nopdf" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    (async () => {
      try {
        let page = cite.page;
        let info = await source.pageInfo(page);
        let rects: Rect[] | null = null;
        if (cite.quote) {
          const { boxes } = await source.textLayer(page);
          rects = locateQuote(boxes, cite.quote, info);
        }
        if (!rects && cite.label) {
          const found = findCaption(await latestCaptions.current(), cite.label, cite.page);
          if (found) {
            if (found.page !== page) info = await source.pageInfo(found.page);
            page = found.page;
            rects = [found.rect];
          }
        }
        if (ctrl.signal.aborted) return;
        if (!(info.width > 0 && info.height > 0)) throw new Error("page without a size");
        const target = canvas.current;
        const box = scroller.current;
        if (!target || !box) return;
        // the page is drawn at the width of the card (pdf.js draws it sharp on any screen)
        const width = box.clientWidth || CARD_WIDTH;
        await source.render(page, target, width / info.width, ctrl.signal);
        if (ctrl.signal.aborted) return;
        box.scrollTop = peekScrollTop(rects, target.offsetHeight, box.clientHeight);
        const asked = Boolean(cite.quote || cite.label);
        setState({ status: asked && !rects ? "unlocated" : "ready", page, rects: rects ?? [] });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => ctrl.abort();
  }, [source, cite.page, cite.quote, cite.label?.kind, cite.label?.number]);

  const shownPage = "page" in state ? state.page : cite.page;
  const message = MESSAGES[state.status];
  const showPage = state.status === "ready" || state.status === "unlocated";
  return (
    <aside className="citation-peek" aria-label="Preview of the paper">
      <header>
        <strong>{`p.${shownPage}`}</strong>
        <IconButton
          icon="external"
          label="Open in the PDF"
          size={16}
          onClick={() => onOpen(cite)}
        />
        <IconButton icon="close" label="Close the preview" size={16} onClick={onClose} />
      </header>
      {message && <p role="status">{message}</p>}
      <div
        className={state.status === "loading" ? "peek-scroll peek-loading" : "peek-scroll"}
        ref={scroller}
        hidden={state.status === "nopdf" || state.status === "error"}
      >
        <div className="peek-sheet">
          <canvas ref={canvas} />
          {showPage &&
            state.rects.map(([x, y, w, h]) => (
              <span
                key={`${x}-${y}`}
                className="peek-highlight"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${w * 100}%`,
                  height: `${h * 100}%`,
                }}
              />
            ))}
        </div>
      </div>
    </aside>
  );
}
