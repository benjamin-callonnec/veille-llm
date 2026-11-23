import { stripQuizMarker } from "../lib/quiz";

// same citation pattern as Markdown.tsx and the server
const CITE = /\s*\[p\.\d+(?:\s*[:,]?\s*["“«][^"”»\]]*["”»])?\s*\]/g;
const OPEN_CITE = /\s*\[p\.[^\]]*$/;
const MAX_SENTENCE = 300;

/** The answer as it should be heard: no markdown, no citations, no code. */
export function spokenText(markdown: string): string {
  let t = stripQuizMarker(markdown);
  t = t.replace(/```[\s\S]*?(```|$)/g, "\n"); // fenced code, also one still being written
  t = t.replace(CITE, "").replace(OPEN_CITE, "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "");
  t = t.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ""); // table separator rows
  t = t.replace(/\|/g, " ");
  t = t.replace(/(\*\*|__|~~)/g, "").replace(/(^|[\s(])[*_]+|[*_]+(?=[\s).,;:!?]|$)/g, "$1");
  t = t.replace(/`([^`]*)`/g, "$1").replace(/`/g, "");
  t = t.replace(/\$\$?([^$]*)\$\$?/g, "$1");
  t = t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  return t.replace(/\n{2,}/g, "\n").trim();
}

const END = /[.!?…]+["')\]”»]*(?=\s)|\n/g;

/**
 * The complete sentences of `text` from `from` on, and where to resume. The tail without a stop
 * waits for more text unless `final`: "3." may still become "3.5".
 */
export function sentencesFrom(
  text: string,
  from: number,
  final: boolean,
): { sentences: string[]; next: number } {
  const sentences: string[] = [];
  let cursor = from;
  const push = (s: string) => {
    const clean = s.trim();
    if (clean) sentences.push(clean);
  };
  const cutLong = (until: number) => {
    while (until - cursor > MAX_SENTENCE) {
      const window = text.slice(cursor, cursor + MAX_SENTENCE);
      const space = window.lastIndexOf(" ");
      const at = space > 0 ? cursor + space : cursor + MAX_SENTENCE;
      push(text.slice(cursor, at));
      cursor = at;
    }
  };
  END.lastIndex = from;
  for (let m = END.exec(text); m; m = END.exec(text)) {
    const stop = m.index + (m[0] === "\n" ? 0 : m[0].length);
    cutLong(stop);
    push(text.slice(cursor, stop));
    cursor = m[0] === "\n" ? m.index + 1 : stop;
  }
  if (final) {
    cutLong(text.length);
    push(text.slice(cursor));
    cursor = text.length;
  } else {
    cutLong(text.length - 1);
  }
  return { sentences, next: cursor };
}
