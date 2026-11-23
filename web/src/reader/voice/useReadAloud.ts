import { useCallback, useEffect, useRef, useState } from "react";
import { sentencesFrom, stableSpokenText } from "./spoken";
import { browserSynth, claimVoice, releaseVoice, type Synth, TtsQueue } from "./tts";

let shared: Synth | null | undefined;
/** The browser voice, looked up once. */
export function defaultSynth(): Synth | null {
  if (shared === undefined) shared = browserSynth();
  return shared;
}

/**
 * Reads an answer aloud, sentence by sentence, also while it is still being written. `toggle`
 * starts (or restarts from the top) and stops. Only one reading at a time in the whole page.
 */
export function useReadAloud(text: string, streaming: boolean, synth: Synth | null) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<TtsQueue | null>(null);
  const cursor = useRef(0);
  const activeRef = useRef(false);
  const latest = useRef({ text, streaming });
  latest.current = { text, streaming };

  const stop = useCallback(() => {
    queue.current?.cancel();
    activeRef.current = false;
    setActive(false);
    releaseVoice(stop);
  }, []);

  const feed = useCallback(
    (value: string, live: boolean) => {
      const q = queue.current;
      if (!q) return;
      const spoken = stableSpokenText(value, !live);
      const { sentences, next } = sentencesFrom(spoken, cursor.current, !live);
      cursor.current = next;
      for (const s of sentences) q.enqueue(s);
      if (!live) q.finish();
      if (!live && q.state === "idle" && activeRef.current) stop(); // nothing to say
    },
    [stop],
  );

  /** Start a reading from the top; does nothing when one is already on (safe to call twice). */
  const start = useCallback(() => {
    if (!synth || activeRef.current) return;
    claimVoice(stop);
    setError(null);
    queue.current = new TtsQueue(
      synth,
      (state) => {
        if (state === "idle" && activeRef.current) {
          activeRef.current = false;
          setActive(false);
          releaseVoice(stop);
        }
      },
      () => setError("Could not read aloud."),
    );
    cursor.current = 0;
    activeRef.current = true;
    setActive(true);
    feed(text, streaming);
  }, [synth, stop, feed, text, streaming]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [start, stop]);

  // the answer grows while a reading is on: speak what just became a full sentence
  // biome-ignore lint/correctness/useExhaustiveDependencies: only new text matters
  useEffect(() => {
    if (activeRef.current) feed(text, streaming);
  }, [text, streaming]);

  // Leaving mid-stream means the answer was just stored (the feed swaps the live message for the
  // saved one): say the rest of it instead of cutting the voice. Leaving otherwise stops it.
  useEffect(
    () => () => {
      if (!activeRef.current) return;
      if (latest.current.streaming) feed(latest.current.text, false);
      else stop();
    },
    [stop, feed],
  );

  return { supported: synth !== null, active, error, toggle, start };
}
