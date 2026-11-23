import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconButton } from "../components/Icon";
import { firstRectTop, scrollTargetTop } from "./lib/goto";
import { locateQuote } from "./lib/locate";
import { pageOffsets, visibleWindow } from "./lib/pages";
import { type Quote, type Rect, toQuote } from "./lib/quote";
import { OutlineMenu } from "./OutlineMenu";
import type { PageInfo, PdfSource, TextBox } from "./pdf/source";
import { SearchBar } from "./SearchBar";

export interface ViewerHighlight {
  id: number;
  page: number;
  color: string;
  rects: Rect[];
}

export interface Selection {
  quote: Quote;
  anchor: { x: number; y: number };
}

interface Props {
  source: PdfSource;
  page: number;
  onPageChange(page: number): void;
  onSelection(selection: Selection | null): void;
  highlights: ViewerHighlight[];
  /** Where to go precisely: scroll to it and flash it for a moment; a new nonce restarts it. */
  target?: Target;
  onTargetDone?(): void;
  /** How long the flash stays, in ms. */
  flashMs?: number;
}

/** A place in the PDF: stored rects, or a quote to locate in the text of the page. */
export interface Target {
  page: number;
  rects?: Rect[];
  quote?: string;
  nonce: number;
}

const GAP = 12;
const OVERSCAN = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const ZOOM_KEY = "veille-reader-zoom";
const FALLBACK_SIZE: PageInfo = { width: 600, height: 800 };

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

function loadZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1;
  } catch {
    return 1;
  }
}

function PageView({
  source,
  page,
  scale,
  size,
  highlights,
  query,
  target,
  flashMs,
  onTargetDone,
  onResolved,
}: {
  source: PdfSource;
  page: number;
  scale: number;
  size: PageInfo;
  highlights: ViewerHighlight[];
  query: string;
  target?: Target;
  flashMs: number;
  onTargetDone?(): void;
  onResolved?(rects: Rect[]): void;
}) {
  const [flashRects, setFlashRects] = useState<Rect[]>([]);
  const done = useRef(onTargetDone);
  done.current = onTargetDone;
  const resolved = useRef(onResolved);
  resolved.current = onResolved;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);
  const needle = query.trim().toLowerCase();
  const layer = useRef<HTMLDivElement>(null);

  // The invisible text uses another font than the PDF: stretch each piece to pdf.js' width.
  useLayoutEffect(() => {
    const spans = layer.current?.children ?? [];
    // read every width first, then write every transform: one layout instead of one per span
    const widths = boxes.map((_, i) => (spans[i] as HTMLElement | undefined)?.offsetWidth ?? 0);
    boxes.forEach((b, i) => {
      const el = spans[i] as HTMLElement | undefined;
      const natural = widths[i] ?? 0;
      if (el)
        el.style.transform =
          natural > 0 && b.width > 0 ? `scaleX(${(b.width * scale) / natural})` : "";
    });
  }, [boxes, scale]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const controller = new AbortController();
    source.render(page, el, scale, controller.signal).catch(() => {});
    return () => {
      controller.abort();
      el.width = 0;
      el.height = 0;
    };
  }, [source, page, scale]);

  useEffect(() => () => source.release?.(page), [source, page]);

  useEffect(() => {
    let current = true;
    source
      .textLayer(page)
      .then((t) => current && setBoxes(t.boxes))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [source, page]);

  // Stored rects are shown at once; a quote waits for the text of the page, then is located.
  const quote = target?.quote;
  const stored = target?.rects;
  const nonce = target?.nonce;
  const wanted = target !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new nonce restarts the flash
  useEffect(() => {
    if (!wanted) return;
    let rects: Rect[] | null = null;
    if (stored?.length) rects = stored;
    else if (quote !== undefined) {
      if (!boxes.length) return;
      rects = locateQuote(boxes, quote, size);
    }
    if (!rects) {
      done.current?.();
      return;
    }
    resolved.current?.(rects);
    setFlashRects(rects);
    const timer = setTimeout(() => {
      setFlashRects([]);
      done.current?.();
    }, flashMs);
    return () => {
      clearTimeout(timer);
      setFlashRects([]);
    };
  }, [boxes, wanted, quote, nonce, size, flashMs]);

  return (
    <div className="pdf-text" style={{ width: size.width * scale, height: size.height * scale }}>
      <canvas ref={canvas} />
      <div className="pdf-text-layer" ref={layer}>
        {boxes.map((b, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: boxes are static for a page
            key={i}
            className={needle && b.text.toLowerCase().includes(needle) ? "pdf-match" : undefined}
            style={{
              left: b.x * scale,
              top: b.y * scale,
              fontSize: b.height * scale,
              height: b.height * scale,
            }}
          >
            {b.text}
          </span>
        ))}
      </div>
      {highlights.flatMap((h) =>
        h.rects.map(([x, y, w, ht], i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rects of one highlight are fixed
            key={`${h.id}-${i}`}
            data-highlight={h.id}
            className={`hl hl-${h.color}`}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${ht * 100}%`,
            }}
          />
        )),
      )}
      {flashRects.map(([x, y, w, ht], i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rects of one flash are fixed
          key={`${nonce}-${i}`}
          data-flash=""
          className="hl-flash"
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${w * 100}%`,
            height: `${ht * 100}%`,
            animationDuration: `${flashMs}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function PdfViewer({
  source,
  page,
  onPageChange,
  onSelection,
  highlights,
  target,
  onTargetDone,
  flashMs = 3500,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(loadZoom);
  const [sizes, setSizes] = useState<Record<number, PageInfo>>({});
  const [win, setWin] = useState({ first: 0, last: 0 });
  const [draft, setDraft] = useState(String(page));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const current = useRef(page);
  const total = source.numPages;

  const base = sizes[1] ?? FALLBACK_SIZE;
  const computed = Array.from({ length: total }, (_, i) => (sizes[i + 1] ?? base).height * scale);
  const previous = useRef<number[]>([]);
  // Same heights, same array: a size that merely confirms the fallback must not re-anchor the scroll.
  const heights =
    previous.current.length === computed.length &&
    previous.current.every((h, i) => h === computed[i])
      ? previous.current
      : computed;
  previous.current = heights;
  const offsets = useMemo(() => pageOffsets(heights, GAP), [heights]);

  const refreshWindow = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop;
    setWin(visibleWindow(top, el.clientHeight || 800, heights, GAP, OVERSCAN));
    let p = 1;
    for (let i = 0; i < offsets.length; i++) {
      if ((offsets[i] ?? 0) <= top + 1) p = i + 1;
    }
    if (el.scrollHeight > el.clientHeight && top + el.clientHeight >= el.scrollHeight - 2)
      p = total;
    if (p !== current.current) {
      current.current = p;
      onPageChange(p);
    }
  }, [heights, offsets, onPageChange, total]);

  useEffect(() => {
    source
      .pageInfo(1)
      .then((info) => setSizes((s) => ({ ...s, 1: info })))
      .catch(() => {});
  }, [source]);

  useEffect(() => {
    for (let p = win.first + 1; p <= win.last + 1; p++) {
      if (sizes[p]) continue;
      source
        .pageInfo(p)
        .then((info) => setSizes((s) => (s[p] ? s : { ...s, [p]: info })))
        .catch(() => {});
    }
  }, [win, sizes, source]);

  // Heights changed (zoom, real page sizes): keep the current page in place, then refresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the layout changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && offsets.length) el.scrollTop = offsets[current.current - 1] ?? 0;
    refreshWindow();
  }, [offsets]);

  // The parent asks for another page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the parent changes page
  useLayoutEffect(() => {
    setDraft(String(page));
    if (page === current.current) return;
    current.current = page;
    const el = scroller.current;
    if (el) el.scrollTop = offsets[page - 1] ?? 0;
    refreshWindow();
  }, [page]);

  // A target was located on its page: bring its box a third from the top of the view.
  const scrollToRects = (p: number, rects: Rect[]) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = scrollTargetTop(
      offsets[p - 1] ?? 0,
      firstRectTop(rects) * (heights[p - 1] ?? 0),
      el.clientHeight || 800,
    );
  };

  const zoom = (delta: number) =>
    setScale((s) => {
      const next = clampZoom(Math.round((s + delta) * 100) / 100);
      try {
        localStorage.setItem(ZOOM_KEY, String(next));
      } catch {
        // zoom is simply not remembered
      }
      return next;
    });

  const goto = (p: number) => {
    if (p >= 1 && p <= total) onPageChange(p);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "PageDown") goto(page + 1);
    else if (e.key === "PageUp") goto(page - 1);
    else if (e.key === "+" || e.key === "=") zoom(ZOOM_STEP);
    else if (e.key === "-") zoom(-ZOOM_STEP);
    else if (e.key === "/") setSearching(true);
    else return;
    e.preventDefault();
  };

  const reportSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return onSelection(null);
    const range = sel.getRangeAt(0);
    const start = range.startContainer;
    const startEl = (start instanceof Element ? start : start.parentElement)?.closest<HTMLElement>(
      "[data-page]",
    );
    if (!startEl || !scroller.current?.contains(startEl)) return onSelection(null);
    const box = startEl.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
      .filter((r) => r.y >= box.y && r.y <= box.y + box.height);
    const quote = toQuote(Number(startEl.dataset.page), sel.toString(), rects, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
    const last = rects.at(-1);
    if (!quote || !last) return onSelection(null);
    onSelection({ quote, anchor: { x: last.x + last.width, y: last.y + last.height } });
  };

  const pages = [];
  for (let p = win.first + 1; p <= Math.min(win.last + 1, total); p++) {
    const size = sizes[p] ?? base;
    pages.push(
      <div
        key={p}
        data-page={p}
        className="pdf-page"
        style={{ top: offsets[p - 1] ?? 0, width: size.width * scale, height: size.height * scale }}
      >
        <PageView
          source={source}
          page={p}
          scale={scale}
          size={size}
          highlights={highlights.filter((h) => h.page === p)}
          query={query}
          target={target?.page === p ? target : undefined}
          flashMs={flashMs}
          onTargetDone={onTargetDone}
          onResolved={(rects) => scrollToRects(p, rects)}
        />
      </div>,
    );
  }
  const totalHeight = (offsets.at(-1) ?? 0) + (heights.at(-1) ?? 0);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <label>
          Page
          <input
            type="number"
            aria-label="Page"
            min={1}
            max={total}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goto(Number.parseInt(draft, 10));
            }}
          />
        </label>
        <span className="muted">/ {total}</span>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-ZOOM_STEP)}>
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>
          +
        </button>
        <IconButton icon="search" label="Search" onClick={() => setSearching(true)} />
        <OutlineMenu source={source} onGo={goto} />
      </div>
      {searching && (
        <SearchBar
          source={source}
          onGo={goto}
          onQuery={setQuery}
          onClose={() => {
            setSearching(false);
            setQuery("");
          }}
        />
      )}
      <section
        className="pdf-scroll"
        data-testid="pdf-scroll"
        aria-label="PDF pages"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable
        tabIndex={0}
        ref={scroller}
        onScroll={refreshWindow}
        onKeyDown={onKey}
        onMouseUp={reportSelection}
        onKeyUp={(e) => e.shiftKey && reportSelection()}
      >
        <div className="pdf-canvas" style={{ height: totalHeight }}>
          {pages}
        </div>
      </section>
    </div>
  );
}
