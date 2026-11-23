import { useEffect, useState } from "react";
import { type Available, hintAt } from "../lib/hints";

export const HINT_INTERVAL_MS = 6000;
export const HINT_FADE_MS = 200;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/**
 * The placeholder of the empty composer. It changes slowly, with a short fade, only while it is
 * `enabled` (nothing typed, no answer running); with reduced motion it stays on the first hint.
 */
export function useHint(enabled: boolean, have: Available): { text: string; fading: boolean } {
  const [n, setN] = useState(0);
  const [fading, setFading] = useState(false);
  const reduce = reducedMotion();
  useEffect(() => {
    if (!enabled || reduce) return;
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
  }, [enabled, reduce]);
  return { text: hintAt(n, have), fading: enabled && fading };
}
