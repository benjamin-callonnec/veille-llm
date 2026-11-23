import { type Available, TIPS } from "./tips";

/** What the empty composer says first, and between the tips. */
export const FIRST_HINT = "Ask about the paper…";

const WRITTEN_ORDER = TIPS.map((_, i) => i);

/** A random order of `length` things (Fisher-Yates): the tips do not always come in the same order. */
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

/** One round with no recommendation: the invitation, then the tips that exist, in `order`. */
export function idleSequence(have: Available, order: number[] = WRITTEN_ORDER): string[] {
  const tips = order
    .map((i) => TIPS[i])
    .filter((t) => t !== undefined && (!t.needs || have[t.needs]))
    .map((t) => (t as { text: string }).text);
  return [FIRST_HINT, ...tips];
}

/** The nth hint when there is nothing to recommend (the round starts again after the last tip). */
export function idleHint(n: number, have: Available, order: number[] = WRITTEN_ORDER): string {
  const sequence = idleSequence(have, order);
  return sequence[n % sequence.length] ?? FIRST_HINT;
}

/** The nth recommended next question (they take turns); null when there is none. */
export function recoAt(n: number, recommendations: string[]): string | null {
  return recommendations.length > 0 ? (recommendations[n % recommendations.length] ?? null) : null;
}
