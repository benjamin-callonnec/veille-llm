export type SttError = "denied" | "no-speech" | "network" | "other";

export interface SttHandlers {
  /** The words heard so far in the current phrase (not final, may still change). */
  onPartial(text: string): void;
  /** A phrase the engine is sure of: append it. */
  onFinal(text: string): void;
  onError(kind: SttError): void;
  /** Listening stopped, whatever the reason. Called once per `start`. */
  onEnd(): void;
}

/** A speech to text engine: the browser's today, a local model through the voice WebSocket later. */
export interface SttEngine {
  /** Asks for the microphone if needed (so only call it from a click) and starts listening. */
  start(handlers: SttHandlers): void;
  stop(): void;
}

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

const MESSAGES: Record<SttError, string> = {
  denied: "The microphone is blocked. Allow it for this page in the browser settings.",
  "no-speech": "Nothing heard. Try again.",
  network:
    "Dictation needs an internet connection: the browser sends the audio to its speech service.",
  other: "Dictation stopped unexpectedly.",
};

export function messageOf(kind: SttError): string {
  return MESSAGES[kind];
}

/** The browser's Web Speech recognition, or null where it is missing (Firefox, jsdom...). */
export function browserStt(lang = navigator.language): SttEngine | null {
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  let current: Recognition | null = null;
  return {
    start(h) {
      const rec = new Ctor();
      current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang;
      rec.onresult = (e) => {
        let partial = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r) continue;
          if (r.isFinal) h.onFinal((r[0]?.transcript ?? "").trim());
          else partial += r[0]?.transcript ?? "";
        }
        h.onPartial(partial.trim());
      };
      rec.onerror = (e) => {
        if (e.error === "aborted") return;
        const denied = e.error === "not-allowed" || e.error === "service-not-allowed";
        h.onError(
          denied
            ? "denied"
            : e.error === "no-speech"
              ? "no-speech"
              : e.error === "network"
                ? "network"
                : "other",
        );
      };
      rec.onend = () => {
        if (current === rec) current = null;
        h.onEnd();
      };
      try {
        rec.start();
      } catch {
        h.onError("other");
        h.onEnd();
      }
    },
    stop() {
      current?.stop();
    },
  };
}
