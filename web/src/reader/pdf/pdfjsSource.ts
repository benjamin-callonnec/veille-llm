import type { OutlineEntry, PageInfo, PdfSource, TextBox } from "./source";
import { PdfOpenError } from "./source";

type PdfJs = typeof import("pdfjs-dist");
type Doc = import("pdfjs-dist").PDFDocumentProxy;

interface RawOutline {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutline[];
}

function reasonOf(error: unknown): PdfOpenError["reason"] {
  const name = (error as { name?: string } | null)?.name;
  if (name === "PasswordException") return "password";
  if (name === "InvalidPDFException") return "invalid";
  return "network";
}

/** The only place that talks to pdf.js. Scripting, eval and XFA stay off; links are never drawn. */
export async function openPdf(url: string): Promise<PdfSource> {
  const pdfjs: PdfJs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  // isEvalSupported is a real pdf.js option missing from its published types.
  const params = { url, isEvalSupported: false, enableXfa: false } as Parameters<
    PdfJs["getDocument"]
  >[0];
  const task = pdfjs.getDocument(params);
  let doc: Doc;
  try {
    doc = await task.promise;
  } catch (error) {
    throw new PdfOpenError(reasonOf(error));
  }
  return new PdfJsSource(pdfjs, doc, task);
}

class PdfJsSource implements PdfSource {
  numPages: number;
  private pages = new Map<number, ReturnType<Doc["getPage"]>>();

  constructor(
    private pdfjs: PdfJs,
    private doc: Doc,
    private task: { destroy?: () => Promise<void> },
  ) {
    this.numPages = doc.numPages;
  }

  private page(n: number) {
    let page = this.pages.get(n);
    if (!page) {
      page = this.doc.getPage(n);
      this.pages.set(n, page);
    }
    return page;
  }

  async pageInfo(n: number): Promise<PageInfo> {
    const viewport = (await this.page(n)).getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  }

  async render(n: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    const page = await this.page(n);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${viewport.width / ratio}px`;
    canvas.style.height = `${viewport.height / ratio}px`;
    try {
      await page.render({ canvas, viewport }).promise;
    } catch (error) {
      if ((error as { name?: string }).name !== "RenderingCancelledException") throw error;
    }
  }

  async textLayer(n: number): Promise<{ text: string; boxes: TextBox[] }> {
    const page = await this.page(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: TextBox[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const t = this.pdfjs.Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(t[2] ?? 0, t[3] ?? 0);
      boxes.push({
        text: item.str,
        x: t[4] ?? 0,
        y: (t[5] ?? 0) - height * 0.85,
        width: item.width,
        height,
      });
    }
    return { text: boxes.map((b) => b.text).join(" "), boxes };
  }

  async outline(): Promise<OutlineEntry[]> {
    const raw = (await this.doc.getOutline()) as RawOutline[] | null;
    const out: OutlineEntry[] = [];
    const walk = async (entries: RawOutline[]) => {
      for (const entry of entries) {
        const page = await this.pageOfDest(entry.dest);
        if (page !== null) out.push({ title: entry.title, page });
        if (entry.items?.length) await walk(entry.items);
      }
    };
    await walk(raw ?? []);
    return out;
  }

  private async pageOfDest(dest: string | unknown[] | null): Promise<number | null> {
    try {
      const resolved = typeof dest === "string" ? await this.doc.getDestination(dest) : dest;
      const target = resolved?.[0];
      if (target === undefined || target === null) return null;
      if (typeof target === "number") return target + 1;
      return (await this.doc.getPageIndex(target as { num: number; gen: number })) + 1;
    } catch {
      return null;
    }
  }

  destroy(): void {
    void this.task.destroy?.();
  }
}
