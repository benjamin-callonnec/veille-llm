import type { OutlineEntry, PageInfo, PdfSource, TextBox } from "./source";

interface Options {
  numPages?: number;
  size?: PageInfo;
  text?: (page: number) => string;
  outline?: OutlineEntry[];
  failTextOn?: number[];
}

/** Test double: no drawing, just records what the viewer asked for. */
export class FakeSource implements PdfSource {
  numPages: number;
  renders: { page: number; scale: number; signal?: AbortSignal }[] = [];
  released: number[] = [];
  destroyed = false;
  private size: PageInfo;
  private textOf: (page: number) => string;
  private entries: OutlineEntry[];
  private failText: number[];

  constructor(o: Options = {}) {
    this.numPages = o.numPages ?? 3;
    this.size = o.size ?? { width: 600, height: 800 };
    this.textOf = o.text ?? ((p) => `Text of page ${p}`);
    this.entries = o.outline ?? [];
    this.failText = o.failTextOn ?? [];
  }

  async pageInfo(): Promise<PageInfo> {
    return this.size;
  }

  async render(
    page: number,
    _canvas: HTMLCanvasElement,
    scale: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.renders.push({ page, scale, signal });
  }

  release(page: number): void {
    this.released.push(page);
  }

  async textLayer(page: number): Promise<{ text: string; boxes: TextBox[] }> {
    if (this.failText.includes(page)) throw new Error("text failed");
    const text = this.textOf(page);
    return { text, boxes: [{ text, x: 50, y: 100, width: 200, height: 12 }] };
  }

  async outline(): Promise<OutlineEntry[]> {
    return this.entries;
  }

  destroy(): void {
    this.destroyed = true;
  }
}
