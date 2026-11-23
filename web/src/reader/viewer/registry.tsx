import type { ReactNode } from "react";
import { HtmlFrame } from "./HtmlFrame";

export type ViewerKind = "html";

export interface ViewerProps {
  content: string;
  title: string;
  /** A key typed inside the file that the app wants (V, Escape). */
  onKey?: (key: string) => void;
}

/** One renderer per type of file: adding a type is adding an entry here. */
export const RENDERERS: Record<ViewerKind, (props: ViewerProps) => ReactNode> = {
  html: HtmlFrame,
};

export function rendererFor(kind: string): ((props: ViewerProps) => ReactNode) | null {
  return Object.hasOwn(RENDERERS, kind) ? RENDERERS[kind as ViewerKind] : null;
}
