import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { locateQuote } from "../lib/locate";
import type { Rect } from "../lib/quote";
import type { PdfSource } from "../pdf/source";
import { type Caption, findCaption } from "../structureApi";
import { type CiteRef, cropFor } from "./peek";

const CARD_WIDTH = 420;
const HIGHLIGHT = "rgba(255, 213, 0, 0.35)";

type State =
  | { status: "loading" }
  | { status: "ready" | "unlocated"; page: number }
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

/** A glance at the paper: the page cut around the cited passage, the passage highlighted. */
export function CitationPeek({ cite, source, captions, onOpen, onClose }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
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
        const band = cropFor(rects);
        const whole = document.createElement("canvas");
        await source.render(page, whole, CARD_WIDTH / info.width, ctrl.signal);
        if (ctrl.signal.aborted) return;
        draw(canvas.current, whole, band, rects);
        const asked = Boolean(cite.quote || cite.label);
        setState({ status: asked && !rects ? "unlocated" : "ready", page });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => ctrl.abort();
  }, [source, cite.page, cite.quote, cite.label?.kind, cite.label?.number]);

  const shownPage = "page" in state ? state.page : cite.page;
  const message = MESSAGES[state.status];
  return (
    <aside className="citation-peek" aria-label="Preview of the paper">
      <header>
        <strong>{`p.${shownPage}`}</strong>
        <button type="button" onClick={() => onOpen(cite)}>
          Open in the PDF
        </button>
        <IconButton icon="close" label="Close the preview" size={16} onClick={onClose} />
      </header>
      {message && <p role="status">{message}</p>}
      <canvas
        ref={canvas}
        hidden={state.status === "nopdf" || state.status === "error" || state.status === "loading"}
      />
    </aside>
  );
}

/** Copy the band of the rendered page into the card and paint the passage over it. */
function draw(
  target: HTMLCanvasElement | null,
  whole: HTMLCanvasElement,
  band: { y: number; h: number },
  rects: Rect[] | null,
): void {
  const ctx = target?.getContext("2d");
  if (!target || !ctx || whole.width <= 0 || whole.height <= 0) return;
  target.width = whole.width;
  target.height = Math.max(1, Math.round(whole.height * band.h));
  ctx.drawImage(
    whole,
    0,
    band.y * whole.height,
    whole.width,
    band.h * whole.height,
    0,
    0,
    target.width,
    target.height,
  );
  ctx.fillStyle = HIGHLIGHT;
  for (const [x, y, w, h] of rects ?? []) {
    ctx.fillRect(
      x * target.width,
      ((y - band.y) / band.h) * target.height,
      w * target.width,
      (h / band.h) * target.height,
    );
  }
}
