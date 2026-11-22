import { useCallback, useEffect, useState } from "react";
import { type ChatApi, httpChatApi } from "./chat/api";
import { ChatPane } from "./chat/ChatPane";
import { useChat } from "./chat/useChat";
import { HighlightsStrip } from "./HighlightsStrip";
import { parseHash, writeHash } from "./lib/anchor";
import { PaneLayout } from "./PaneLayout";
import { PdfViewer, type Selection } from "./PdfViewer";
import { openPdf } from "./pdf/pdfjsSource";
import { PdfOpenError, type PdfSource } from "./pdf/source";
import { SelectionBox } from "./SelectionBox";
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
}

export function ReaderPage({
  itemId,
  load = loadItem,
  open = openPdf,
  api = httpApi,
  chatApi = httpChatApi,
}: Props) {
  const [item, setItem] = useState<ReaderItem | null>(null);
  const [error, setError] = useState<string | null>(
    itemId ? null : "This item cannot be opened in the reader.",
  );
  const [source, setSource] = useState<PdfSource | null>(null);
  const [page, setPage] = useState(() => parseHash(window.location.hash).page ?? 1);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { highlights, add, remove, error: saveError } = useHighlights(itemId, api);
  const chat = useChat(itemId, chatApi);

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

  const closeBox = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  if (error) {
    return (
      <div className="reader-shell">
        <header className="reader-head"></header>
        <p role="alert">{error}</p>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="reader-shell">
        <header className="reader-head"></header>
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
      />
      <HighlightsStrip highlights={highlights} onGo={changePage} onRemove={remove} />
    </>
  ) : (
    <p className="muted">{item.has_pdf ? "Loading the PDF…" : "No PDF for this item"}</p>
  );

  return (
    <div className="reader-shell">
      <header className="reader-head">
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
      <PaneLayout pdf={pdfPane} chat={<ChatPane chat={chat} onGo={changePage} />} />
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
