import { type Available, TIPS } from "./tips";

/** What the empty composer says first, and between the tips. */
export const FIRST_HINT = "Ask about the paper…";

/**
 * With no recommendation: the invitation, then the tips one after the other, then again.
 * Deterministic, so everybody sees the same sequence and it is easy to test.
 */
export function idleHint(n: number, have: Available): string {
  const sequence = [
    FIRST_HINT,
    ...TIPS.filter((t) => !t.needs || have[t.needs]).map((t) => t.text),
  ];
  return sequence[n % sequence.length] ?? FIRST_HINT;
}

/** The nth recommended next question (they take turns); null when there is none. */
export function recoAt(n: number, recommendations: string[]): string | null {
  return recommendations.length > 0 ? (recommendations[n % recommendations.length] ?? null) : null;
}
