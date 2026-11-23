import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { locateQuote } from "../lib/locate";
import type { Rect } from "../lib/quote";
import type { PdfSource } from "../pdf/source";
import { type Caption, findCaption } from "../structureApi";
import { type CiteRef, peekScrollLeft, peekScrollTop } from "./peek";

/** The width the page gets at 100%: big enough to read the text without zooming. */
const CARD_WIDTH = 640;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

/** Where the citation points: its page, the rectangles of the passage (null: not found). */
interface Located {
  page: number;
  rects: Rect[] | null;
  asked: boolean;
}

type Phase = "loading" | "ready" | "nopdf" | "error";

interface Props {
  cite: CiteRef;
  source: PdfSource | null;
  captions: () => Promise<Caption[]>;
  /** The user wants the real PDF: go there (same jump as a citation of the chat). */
  onOpen(cite: CiteRef): void;
  onClose(): void;
}

/**
 * A glance at the paper: a page that scrolls, already at the cited passage, with the passage
 * highlighted; the page can be zoomed and the neighbouring pages read.
 */
export function CitationPeek({ cite, source, captions, onOpen, onClose }: Props) {
  const [located, setLocated] = useState<Located | null>(null);
  const [browse, setBrowse] = useState<number | null>(null); // a page other than the cited one
  const [zoom, setZoom] = useState(1);
  const [phase, setPhase] = useState<Phase>("loading");
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latestCaptions = useRef(captions);
  latestCaptions.current = captions;

  // 1. Where is the passage? (once per citation)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new citation (same fields) is located again only when its parts change
  useEffect(() => {
    setLocated(null);
    setBrowse(null);
    if (!source) {
      setPhase("nopdf");
      return;
    }
    setPhase("loading");
    const ctrl = new AbortController();
    (async () => {
      try {
        let page = cite.page;
        const info = await source.pageInfo(page);
        let rects: Rect[] | null = null;
        if (cite.quote) {
          const { boxes } = await source.textLayer(page);
          rects = locateQuote(boxes, cite.quote, info);
        }
        if (!rects && cite.label) {
          const found = findCaption(await latestCaptions.current(), cite.label, cite.page);
          if (found) {
            page = found.page;
            rects = [found.rect];
          }
        }
        if (ctrl.signal.aborted) return;
        setLocated({ page, rects, asked: Boolean(cite.quote || cite.label) });
      } catch {
        if (!ctrl.signal.aborted) setPhase("error");
      }
    })();
    return () => ctrl.abort();
  }, [source, cite.page, cite.quote, cite.label?.kind, cite.label?.number]);

  const shown = browse ?? located?.page ?? cite.page;
  const onCitedPage = located !== null && shown === located.page;

  // 2. Draw the page being shown (the cited one, or a neighbour), at the zoom, at the passage
  useEffect(() => {
    if (!source || !located) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const info = await source.pageInfo(shown);
        if (ctrl.signal.aborted) return;
        if (!(info.width > 0 && info.height > 0)) throw new Error("page without a size");
        const target = canvas.current;
        const box = scroller.current;
        if (!target || !box) return;
        // drawn at the width of the card times the zoom: pdf.js makes it sharp on any screen
        const width = (box.clientWidth || CARD_WIDTH) * zoom;
        await source.render(shown, target, width / info.width, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const rects = shown === located.page ? located.rects : null;
        box.scrollTop = peekScrollTop(rects, target.offsetHeight, box.clientHeight);
        box.scrollLeft = peekScrollLeft(rects, target.offsetWidth, box.clientWidth);
        setPhase("ready");
      } catch {
        if (!ctrl.signal.aborted) setPhase("error");
      }
    })();
    return () => ctrl.abort();
  }, [source, located, shown, zoom]);

  const lastPage = source?.numPages ?? 0;
  const noteMissing = phase === "ready" && onCitedPage && located.asked && !located.rects;
  const message =
    phase === "nopdf"
      ? "No PDF for this paper"
      : phase === "error"
        ? "The preview could not be drawn"
        : noteMissing
          ? "Passage not located"
          : null;
  const rects = onCitedPage && phase === "ready" ? (located.rects ?? []) : [];
  return (
    <aside className="citation-peek" aria-label="Preview of the paper">
      <header>
        <IconButton
          icon="arrow-up"
          label="Previous page"
          size={16}
          disabled={!source || shown <= 1}
          onClick={() => setBrowse(shown - 1)}
        />
        <strong>{`p.${shown}`}</strong>
        <span className="peek-total">{`/ ${source ? lastPage : "?"}`}</span>
        <IconButton
          icon="arrow-down"
          label="Next page"
          size={16}
          disabled={!source || shown >= lastPage}
          onClick={() => setBrowse(shown + 1)}
        />
        <span className="peek-spacer" />
        <IconButton
          icon="minus"
          label="Zoom out"
          size={16}
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
        />
        <span className="peek-zoom">{`${Math.round(zoom * 100)}%`}</span>
        <IconButton
          icon="plus"
          label="Zoom in"
          size={16}
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
        />
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
        className={phase === "loading" ? "peek-scroll peek-loading" : "peek-scroll"}
        ref={scroller}
        hidden={phase === "nopdf" || phase === "error"}
      >
        <div className="peek-sheet">
          <canvas ref={canvas} />
          {rects.map(([x, y, w, h]) => (
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
