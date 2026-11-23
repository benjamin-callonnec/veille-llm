import { useEffect, useState } from "react";
import { FIRST_HINT, idleHint, idleSequence, recoAt, shuffledOrder } from "../lib/hints";
import { type Available, TIPS } from "../lib/tips";

export const HINT_INTERVAL_MS = 6000;
export const HINT_FADE_MS = 200;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/**
 * The placeholder of the empty composer: the recommended next questions when the tutor has some
 * (they take turns, Tab fills the one shown), otherwise the invitation and the tips (in a random
 * order, drawn again for each round). It changes
 * slowly, with a short fade, only while `enabled` (nothing typed, no answer running); a single
 * recommendation, or reduced motion, keeps it still.
 */
export function useHint(
  enabled: boolean,
  have: Available,
  recommendations: string[],
): { text: string; reco: string | null; fading: boolean } {
  const [n, setN] = useState(0);
  const [fading, setFading] = useState(false);
  // the tips are drawn again at each opening and at the start of each round
  const [order, setOrder] = useState(() => shuffledOrder(TIPS.length));
  const reduce = reducedMotion();
  const key = recommendations.join("\u0001");

  // other recommendations start again from the first one
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the list
  useEffect(() => {
    setN(0);
    setFading(false);
  }, [key]);

  const rotates = enabled && !reduce && recommendations.length !== 1;
  useEffect(() => {
    if (!rotates) return;
    let fade: ReturnType<typeof setTimeout> | undefined;
    const every = setInterval(() => {
      setFading(true);
      fade = setTimeout(() => {
        setN((k) => k + 1);
        setFading(false);
      }, HINT_FADE_MS);
    }, HINT_INTERVAL_MS);
    return () => {
      clearInterval(every);
      clearTimeout(fade);
    };
  }, [rotates]);

  const roundLength = idleSequence(have, order).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a round ends when the count wraps
  useEffect(() => {
    if (n > 0 && n % roundLength === 0) setOrder(shuffledOrder(TIPS.length));
  }, [n]);

  const reco = recoAt(n, recommendations);
  const index = reduce ? 0 : n;
  return {
    text: reco ?? (reduce ? FIRST_HINT : idleHint(index, have, order)),
    reco,
    fading: rotates && fading,
  };
}
