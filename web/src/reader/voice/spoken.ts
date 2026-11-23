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

/**
 * The spoken text of an answer that may still grow, cut where a markdown construct is still open
 * (a link, an image, inline math or code): when it closes, stripping it rewrites text that was
 * already counted, which would shift the reading cursor. Once `final`, everything is spoken.
 */
export function stableSpokenText(markdown: string, final: boolean): string {
  if (final) return spokenText(markdown);
  const open = openConstruct(markdown);
  return spokenText(open < 0 ? markdown : markdown.slice(0, open));
}

/** Where the earliest still unfinished link, image, math or inline code begins, or -1. */
function openConstruct(raw: string): number {
  // what sits inside a closed fence is not markdown: only look after the last fence
  const fences = [...raw.matchAll(/```/g)];
  if (fences.length % 2 === 1) return -1; // inside code: spokenText already drops it
  const from = fences.length ? (fences[fences.length - 1]?.index ?? 0) + 3 : 0;
  const tail = raw.slice(from);
  const found: number[] = [];
  const link = /!?\[[^\]]*(?:\](?:\([^)]*)?)?$/.exec(tail);
  if (link) found.push(link.index);
  for (const mark of ["$", "`"]) {
    const at = unmatched(tail, mark);
    if (at >= 0) found.push(at);
  }
  return found.length ? from + Math.min(...found) : -1;
}

/** The last `mark` of an odd count (its partner has not arrived), or -1. */
function unmatched(text: string, mark: string): number {
  let last = -1;
  let count = 0;
  for (let i = text.indexOf(mark); i >= 0; i = text.indexOf(mark, i + 1)) {
    count++;
    last = i;
  }
  return count % 2 === 1 ? last : -1;
}
