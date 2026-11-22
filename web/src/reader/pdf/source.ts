export interface PageInfo {
  width: number;
  height: number;
}

export interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutlineEntry {
  title: string;
  page: number;
}

/** What the viewer needs from a PDF engine. Pages are 1-based; boxes are in scale-1 page units. */
export interface PdfSource {
  numPages: number;
  pageInfo(page: number): Promise<PageInfo>;
  render(page: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  textLayer(page: number): Promise<{ text: string; boxes: TextBox[] }>;
  outline(): Promise<OutlineEntry[]>;
  destroy(): void;
}

export type PdfOpenReason = "password" | "invalid" | "network";

export class PdfOpenError extends Error {
  constructor(public reason: PdfOpenReason) {
    super(reason);
  }
}
