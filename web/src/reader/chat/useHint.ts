import { useEffect, useRef, useState } from "react";
import {
  ENTRY_COUNT,
  FIRST_HINT,
  idleHint,
  idleSequence,
  recoAt,
  shuffledOrder,
} from "../lib/hints";
import type { Available } from "../lib/tips";

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
  // `n` is the position in what is shown: in the recommendations, or in the round of tips
  const [n, setN] = useState(0);
  const [fading, setFading] = useState(false);
  // the texts are drawn again at each opening and for each round (the invitation is one of them)
  const [order, setOrder] = useState(() => shuffledOrder(ENTRY_COUNT));
  const latest = useRef({ n, order, have, recommendations });
  latest.current = { n, order, have, recommendations };
  const reduce = reducedMotion();
  const key = recommendations.join("\u0001");

  // other recommendations start again from the first one
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the list
  useEffect(() => {
    setN(0);
    setFading(false);
  }, [key]);

  const rotates = enabled && !reduce && recommendations.length !== 1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` restarts the clock with the list
  useEffect(() => {
    if (!rotates) return;
    setFading(false); // after a pause the placeholder is never left invisible
    let fade: ReturnType<typeof setTimeout> | undefined;
    const every = setInterval(() => {
      setFading(true);
      fade = setTimeout(() => {
        const { n: current, order: now, have: available, recommendations: recos } = latest.current;
        let next = current + 1;
        // a round of tips is over: draw the next one (nothing to draw while recommendations show)
        if (recos.length === 0 && next >= idleSequence(available, now).length) {
          setOrder(nextRound(now, available));
          next = 0;
        }
        setN(next);
        setFading(false);
      }, HINT_FADE_MS);
    }, HINT_INTERVAL_MS);
    return () => {
      clearInterval(every);
      clearTimeout(fade);
    };
  }, [rotates, key]);

  const reco = recoAt(n, recommendations);
  return {
    text: reco ?? (reduce ? FIRST_HINT : idleHint(n, have, order)),
    reco,
    fading: rotates && fading,
  };
}

/** Another random order, whose first text is not the last text of the round that just ended. */
function nextRound(previous: number[], have: Available): number[] {
  const last = idleSequence(have, previous).at(-1);
  let order = shuffledOrder(ENTRY_COUNT);
  for (let i = 0; i < order.length && idleSequence(have, order)[0] === last; i++) {
    order = [...order.slice(1), order[0] as number];
  }
  return order;
}
