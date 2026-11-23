import { type Available, TIPS } from "./tips";

/** What the empty composer says first, and between the tips. */
export const FIRST_HINT = "Ask about the paper…";

/** What there is to say with nothing to recommend: the invitation, then every tip (index 0 is the invitation). */
const ENTRIES = [{ text: FIRST_HINT }, ...TIPS] as { text: string; needs?: keyof Available }[];
export const ENTRY_COUNT = ENTRIES.length;
const WRITTEN_ORDER = ENTRIES.map((_, i) => i);

/** A random order of `length` things (Fisher-Yates): the texts do not always come in the same order. */
export function shuffledOrder(length: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const kept = order[i] as number;
    order[i] = order[j] as number;
    order[j] = kept;
  }
  return order;
}

/** One round with nothing to recommend: the invitation and the tips that exist, in `order`. */
export function idleSequence(have: Available, order: number[] = WRITTEN_ORDER): string[] {
  const texts = order
    .map((i) => ENTRIES[i])
    .filter((e) => e !== undefined && (!e.needs || have[e.needs]))
    .map((e) => (e as { text: string }).text);
  return texts.length > 0 ? texts : [FIRST_HINT];
}

/** The nth text when there is nothing to recommend (a round starts again after its last text). */
export function idleHint(n: number, have: Available, order: number[] = WRITTEN_ORDER): string {
  const sequence = idleSequence(have, order);
  return sequence[n % sequence.length] ?? FIRST_HINT;
}

/** The nth recommended next question (they take turns); null when there is none. */
export function recoAt(n: number, recommendations: string[]): string | null {
  return recommendations.length > 0 ? (recommendations[n % recommendations.length] ?? null) : null;
}
