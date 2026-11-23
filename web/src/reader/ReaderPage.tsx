import { useCallback, useEffect, useRef, useState } from "react";
import { formatModel } from "../lib/time";
import { type ChatApi, httpChatApi } from "./chat/api";
import { ChatPane } from "./chat/ChatPane";
import type { Label } from "./chat/events";
import { useChat } from "./chat/useChat";
import { HighlightsStrip } from "./HighlightsStrip";
import { parseHash, writeHash } from "./lib/anchor";
import type { Rect } from "./lib/quote";
import { PaneLayout } from "./PaneLayout";
import { PdfViewer, type Selection, type Target } from "./PdfViewer";
import { openPdf } from "./pdf/pdfjsSource";
import { PdfOpenError, type PdfSource } from "./pdf/source";
import { SelectionBox } from "./SelectionBox";
import { type Caption, fetchCaptions, findCaption } from "./structureApi";
import { type HighlightsApi, httpApi, useHighlights } from "./useHighlights";

export interface ReaderItem {
  id: string;
  title: string;
  hook: string;
  url: string;
  type: string;
  has_pdf: boolean;
}

export async function loadItem(id: string): Promise<ReaderItem> {
  const response = await fetch(`/api/items/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as ReaderItem;
}

const MAX_QUOTE_TEXT = 5000;
const MAX_QUOTE_RECTS = 200;
const MAX_HIGHLIGHT_TEXT = 5000;
const clip = (text: string) => text.slice(0, MAX_HIGHLIGHT_TEXT);

async function fetchHealth(): Promise<{ model?: string }> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as { model?: string };
}

const pdfUrl = (id: string) => `/api/items/${encodeURIComponent(id)}/pdf`;

const OPEN_ERRORS = {
  password: "This PDF is password protected and cannot be opened.",
  invalid: "The file is not a valid PDF.",
  network: "The PDF could not be downloaded.",
} as const;

interface Props {
  itemId: string;
  load?: (id: string) => Promise<ReaderItem>;
  open?: (url: string) => Promise<PdfSource>;
  api?: HighlightsApi;
  chatApi?: ChatApi;
  /** Where the captions of figures and tables come from (the structure of the paper). */
  captionsApi?(item: string): Promise<Caption[]>;
  /** Where the model that answers is read from (the API health route by default). */
  health?: () => Promise<{ model?: string }>;
}

export function ReaderPage({
  itemId,
  load = loadItem,
  open = openPdf,
  api = httpApi,
  chatApi = httpChatApi,
  captionsApi = fetchCaptions,
  health = fetchHealth,
}: Props) {
  const [item, setItem] = useState<ReaderItem | null>(null);
  const [error, setError] = useState<string | null>(
    itemId ? null : "This item cannot be opened in the reader.",
  );
  const [source, setSource] = useState<PdfSource | null>(null);
  const [page, setPage] = useState(() => parseHash(window.location.hash).page ?? 1);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { highlights, add, remove, error: saveError } = useHighlights(itemId, api);
  const chat = useChat(itemId, chatApi);
  const [model, setModel] = useState("");

  useEffect(() => {
    let current = true;
    health()
      .then((h) => current && setModel(formatModel(h.model)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [health]);

  useEffect(() => {
    if (!itemId) return;
    let current = true;
    setError(null);
    load(itemId)
      .then((loaded) => current && setItem(loaded))
      .catch(() => current && setError("This item cannot be opened in the reader."));
    return () => {
      current = false;
    };
  }, [itemId, load]);

  useEffect(() => {
    if (!item?.has_pdf) return;
    let current = true;
    let opened: PdfSource | null = null;
    open(pdfUrl(item.id))
      .then((s) => {
        opened = s;
        if (current) setSource(s);
        else s.destroy();
      })
      .catch((e: unknown) => {
        if (current) setError(OPEN_ERRORS[e instanceof PdfOpenError ? e.reason : "network"]);
      });
    return () => {
      current = false;
      opened?.destroy();
    };
  }, [item, open]);

  const changePage = useCallback(
    (p: number) => {
      setPage(p);
      try {
        window.history.replaceState(null, "", writeHash(itemId, p));
      } catch {
        // the address bar is simply not updated
      }
    },
    [itemId],
  );

  // Every way back to the PDF: the page, and the exact place when we know it.
  const goTo = useCallback(
    (p: number, spec?: { rects?: Rect[]; quote?: string }) => {
      changePage(p);
      if (spec?.rects?.length || spec?.quote) setTarget({ page: p, ...spec, nonce: Date.now() });
    },
    [changePage],
  );
  // A figure or a table is placed from the structure of the paper, asked for on the first need.
  const captions = useRef<Promise<Caption[]> | null>(null);
  // Counts the ways back to the PDF: a late answer must not override a later click or paper.
  const moves = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new paper has its own captions
  useEffect(() => {
    captions.current = null;
    moves.current += 1;
  }, [itemId]);
  const cite = useCallback(
    (p: number, quote?: string, label?: Label) => {
      const mine = ++moves.current;
      goTo(p, { quote });
      if (!label) return;
      captions.current ??= captionsApi(itemId);
      const asked = captions.current;
      void asked.then((all) => {
        if (!all.length) captions.current = null; // not available now: ask again next time
        const found = findCaption(all, label, p);
        if (found && mine === moves.current) goTo(found.page, { rects: [found.rect] });
      });
    },
    [goTo, itemId, captionsApi],
  );
  const goToRects = useCallback(
    (p: number, rects?: Rect[]) => {
      moves.current += 1;
      goTo(p, { rects });
    },
    [goTo],
  );

  const closeBox = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  if (error) {
    return (
      <div className="reader-shell">
        <header className="page-head reader-head"></header>
        <p role="alert">{error}</p>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="reader-shell">
        <header className="page-head reader-head"></header>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const pdfPane = source ? (
    <>
      <PdfViewer
        source={source}
        page={page}
        onPageChange={changePage}
        onSelection={setSelection}
        highlights={highlights}
        target={target ?? undefined}
        onTargetDone={() => setTarget(null)}
      />
      <HighlightsStrip highlights={highlights} onGo={goToRects} onRemove={remove} />
    </>
  ) : (
    <p className="muted">{item.has_pdf ? "Loading the PDF…" : "No PDF for this item"}</p>
  );

  return (
    <div className="reader-shell">
      <header className="page-head reader-head">
        <h1>{item.title}</h1>
        <p className="hook">
          <strong>{item.hook}</strong>
        </p>
      </header>
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      {saveError && (
        <p role="status" className="muted">
          The highlight could not be saved.
        </p>
      )}
      <PaneLayout
        pdf={pdfPane}
        chat={<ChatPane chat={chat} onGo={goToRects} onCite={cite} model={model} itemId={itemId} />}
      />
      {selection && (
        <SelectionBox
          quote={selection.quote}
          anchor={selection.anchor}
          onAsk={(question) => {
            if (chat.streaming) {
              setNotice("Wait for the current answer to finish before asking again.");
              return;
            }
            setNotice(null);
            void add(
              selection.quote.page,
              "yellow",
              clip(selection.quote.text),
              selection.quote.rects,
            );
            void chat.send({
              kind: "ask_agent",
              quote: {
                text: selection.quote.text.slice(0, MAX_QUOTE_TEXT),
                page: selection.quote.page,
                rects: selection.quote.rects.slice(0, MAX_QUOTE_RECTS),
              },
              question,
            });
            closeBox();
          }}
          onHighlight={(color) => {
            void add(
              selection.quote.page,
              color,
              clip(selection.quote.text),
              selection.quote.rects,
            );
            closeBox();
          }}
          onCopy={() => {
            navigator.clipboard?.writeText(selection.quote.text).catch(() => {});
            closeBox();
          }}
          onClose={closeBox}
        />
      )}
    </div>
  );
}
