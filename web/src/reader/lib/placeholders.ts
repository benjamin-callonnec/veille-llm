export interface Range {
  start: number;
  end: number;
}

const PLACEHOLDER = /\[[^[\]\n]+\]/g;

/** The `[something]` spots of a text, in order. */
export function placeholders(text: string): Range[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

/**
 * The placeholder to select next from a selection (or caret): the first one after it, or with
 * `back` the last one before it. Null when there is none left that way.
 */
export function nextPlaceholder(
  text: string,
  selStart: number,
  selEnd: number,
  back = false,
): Range | null {
  const all = placeholders(text);
  if (back) return [...all].reverse().find((r) => r.end <= selStart) ?? null;
  return all.find((r) => r.start >= selEnd) ?? null;
}
