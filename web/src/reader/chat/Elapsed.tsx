import { useEffect, useState } from "react";
import { formatElapsed } from "./formatElapsed";

interface Props {
  /** When the question was sent (only while the answer is being produced). */
  startedAt?: number;
  /** The final duration, once the answer is finished (or read from history). */
  durationMs: number | null;
  running: boolean;
  now?: () => number;
}

/** A quiet clock: counts up while the agent answers, then keeps the final duration. */
export function Elapsed({ startedAt, durationMs, running, now = Date.now }: Props) {
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the interval only needs to exist while running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  void tick; // each tick re-renders, the value is read from the clock below

  let ms: number | null = null;
  if (running && startedAt !== undefined) ms = now() - startedAt;
  else if (durationMs !== null) ms = durationMs;
  if (ms === null) return null;
  return (
    <span className="elapsed" role="timer" aria-label="Elapsed time">
      {formatElapsed(ms)}
    </span>
  );
}
