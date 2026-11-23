export type SpeechSpeed = "slow" | "normal" | "fast";
export const SPEEDS: SpeechSpeed[] = ["slow", "normal", "fast"];
/** The `rate` of a browser utterance (1 is the voice's own pace). */
export const RATES: Record<SpeechSpeed, number> = { slow: 0.8, normal: 1, fast: 1.3 };
const KEY = "veille-tts-speed";

const isSpeed = (v: unknown): v is SpeechSpeed =>
  typeof v === "string" && (SPEEDS as string[]).includes(v);

export function loadSpeed(storage: Pick<Storage, "getItem"> | null): SpeechSpeed {
  try {
    const raw = storage?.getItem(KEY);
    return isSpeed(raw) ? raw : "normal";
  } catch {
    return "normal";
  }
}

export function saveSpeed(storage: Pick<Storage, "setItem"> | null, speed: SpeechSpeed): void {
  try {
    storage?.setItem(KEY, speed);
  } catch {
    // the choice is simply not remembered
  }
}
