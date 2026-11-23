import { useEffect, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import type { PdfSource } from "../pdf/source";
import type { Caption } from "../structureApi";
import { CitationPeek } from "./CitationPeek";
import { type CiteRef, parseCite } from "./peek";
import { rendererFor } from "./registry";
import {
  exportUrl,
  getReport,
  type ReportMeta,
  type ReportView,
  restoreReport,
} from "./reportsApi";

interface Props {
  itemId: string;
  reports: ReportMeta[];
  /** False: hidden but kept, so the page is where you left it when it opens again. */
  open?: boolean;
  selectedId: number | null;
  onSelect(id: number): void;
  onClose(): void;
  /** A version was restored: the list of reports must be read again. */
  onChanged(): void;
  /** The paper, to show the passage a citation points at (no PDF: the card says so). */
  source?: PdfSource | null;
  /** The figures and tables of the paper, asked for when a citation names one. */
  captions?: () => Promise<Caption[]>;
  /** The user wants the real PDF at that citation. */
  onOpenPdf?: (cite: CiteRef) => void;
}

const NO_CAPTIONS = async (): Promise<Caption[]> => [];
// without a PDF the number of pages is unknown: only absurd pages are refused
const UNKNOWN_PAGES = 9999;

/** The viewer: one report at a time, its versions, export and full screen. HTML for now. */
export function FileViewer({
  itemId,
  reports,
  open = true,
  selectedId,
  onSelect,
  onClose,
  onChanged,
  source = null,
  captions = NO_CAPTIONS,
  onOpenPdf,
}: Props) {
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [view, setView] = useState<ReportView | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [peek, setPeek] = useState<CiteRef | null>(null);
  const current = reports.find((r) => r.id === selectedId);
  const latest = current?.version;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `latest` reloads the page when the tutor writes a new version
  useEffect(() => {
    if (selectedId === null) {
      setView(null);
      return;
    }
    let live = true;
    getReport(itemId, selectedId, version).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [itemId, selectedId, version, latest]);

  // a new report or a new version shows the newest one
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on purpose when these change
  useEffect(() => setVersion(undefined), [selectedId, latest]);

  // the preview belongs to what is shown: closing the viewer or changing the version drops it
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on purpose when these change
  useEffect(() => setPeek(null), [open, selectedId, view?.version]);

  // Escape closes the preview first, then the viewer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (peek) setPeek(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, peek]);

  // a hidden viewer still runs its page, but what the page says is not heard until it is shown
  const onFrameKey = (key: string) => {
    if (!open) return;
    if (key === "Escape" && peek) setPeek(null);
    else onClose();
  };
  const onFrameCite = (raw: unknown) => {
    if (!open) return;
    const cite = parseCite(raw, source?.numPages ?? UNKNOWN_PAGES);
    if (cite === "close") setPeek(null);
    else if (cite) setPeek(cite);
  };

  const Render = rendererFor("html");
  const shown = view?.version;
  const isOld = shown !== undefined && latest !== undefined && shown < latest;

  const restore = async () => {
    if (selectedId === null || shown === undefined) return;
    if (await restoreReport(itemId, selectedId, shown)) onChanged();
  };

  return (
    <section
      className={fullscreen ? "viewer viewer-fullscreen" : "viewer"}
      aria-label="Viewer"
      hidden={!open}
    >
      <header className="viewer-bar">
        {reports.length > 1 ? (
          <select
            aria-label="Report"
            value={selectedId ?? ""}
            onChange={(e) => onSelect(Number(e.target.value))}
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        ) : (
          <strong className="viewer-title">{current?.title ?? "Viewer"}</strong>
        )}
        {view && (
          <select
            aria-label="Version"
            value={shown}
            onChange={(e) => setVersion(Number(e.target.value))}
          >
            {[...view.versions].reverse().map((v) => (
              <option key={v.version} value={v.version}>
                {`v${v.version} · ${new Date(v.created_at).toLocaleString()}`}
              </option>
            ))}
          </select>
        )}
        {isOld && (
          <button type="button" onClick={restore}>
            Restore this version
          </button>
        )}
        {view && selectedId !== null && (
          <a
            className="icon-btn"
            href={exportUrl(itemId, selectedId, shown)}
            download
            aria-label="Export"
            title="Export"
          >
            <Icon name="download" />
          </a>
        )}
        <IconButton
          icon="expand"
          label="Full screen"
          pressed={fullscreen}
          onClick={() => setFullscreen((f) => !f)}
        />
        <IconButton icon="close" label="Close the viewer" onClick={onClose} />
      </header>
      <div className="viewer-body">
        {view && Render ? (
          <Render
            content={view.html}
            title={view.title}
            active={open}
            onKey={onFrameKey}
            onCite={onFrameCite}
          />
        ) : (
          <p className="viewer-empty">
            {reports.length === 0
              ? "No report yet. Ask the tutor, for instance /present."
              : "Loading…"}
          </p>
        )}
        {peek && (
          <CitationPeek
            cite={peek}
            source={source}
            captions={captions}
            onClose={() => setPeek(null)}
            onOpen={(cite) => {
              setPeek(null);
              onOpenPdf?.(cite);
            }}
          />
        )}
      </div>
    </section>
  );
}
