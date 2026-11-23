import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf, type SttEngine } from "./stt";

/** `text` followed by `more`, with one space between them when both have words. */
export function joinText(text: string, more: string): string {
  if (!more) return text;
  return text && !/\s$/.test(text) ? `${text} ${more}` : text + more;
}

/**
 * Push to talk dictation: `toggle` is called from a click (it is what asks for the microphone).
 * `interim` is the phrase still being recognised; each sure phrase goes to `onText`.
 * Nothing is recorded or kept here: the engine hands over words only.
 */
export function useDictation(
  engine: SttEngine | null,
  onText: (text: string) => void,
  onNotice: (message: string) => void,
) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const interimRef = useRef("");
  const on = useRef(false);
  const abandoned = useRef(false); // set by abandon, until the next start: late results are dropped

  const clear = useCallback(() => {
    interimRef.current = "";
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!engine || on.current) return;
    on.current = true;
    abandoned.current = false;
    setListening(true);
    engine.start({
      onPartial: (t) => {
        if (abandoned.current) return;
        interimRef.current = t;
        setInterim(t);
      },
      onFinal: (t) => {
        if (abandoned.current) return;
        clear();
        if (t) onText(t);
      },
      onError: (kind) => onNotice(messageOf(kind)),
      onEnd: () => {
        const rest = interimRef.current;
        clear();
        if (rest) onText(rest);
        on.current = false;
        setListening(false);
      },
    });
  }, [engine, onText, onNotice, clear]);

  const stop = useCallback(() => engine?.stop(), [engine]);

  /** Stop and drop the phrase in progress (it is already in the text the user is editing). */
  const abandon = useCallback(() => {
    clear();
    if (on.current) {
      abandoned.current = true;
      engine?.stop();
    }
  }, [engine, clear]);

  // leaving the page never leaves the microphone on
  useEffect(
    () => () => {
      if (on.current) engine?.stop();
    },
    [engine],
  );

  const toggle = useCallback(() => (on.current ? stop() : start()), [start, stop]);

  return { listening, interim, toggle, abandon };
}
