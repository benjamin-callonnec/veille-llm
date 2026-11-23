/** Something that can say one sentence: the browser voice, or later a local engine. */
export interface Synth {
  /** Say `text`; `done` is called once it ended, with an error code if it failed. */
  speak(text: string, done: (error?: string) => void): void;
  /** Stop the current sentence at once. */
  cancel(): void;
}

export type TtsState = "idle" | "speaking";

/**
 * Speaks sentences one after the other while more of them can still arrive (an answer being
 * streamed). `finish()` says no more are coming; the queue is idle once they were all said.
 * `cancel()` empties it and ignores the late end of the sentence that was cut.
 */
export class TtsQueue {
  state: TtsState = "idle";
  private items: string[] = [];
  private playing = false;
  private closed = false;
  private run = 0;

  constructor(
    private readonly synth: Synth,
    private readonly onState: (state: TtsState) => void = () => {},
    private readonly onError: (code: string) => void = () => {},
  ) {}

  enqueue(text: string): void {
    this.items.push(text);
    this.set("speaking");
    this.next();
  }

  finish(): void {
    this.closed = true;
    this.next();
  }

  cancel(): void {
    this.run += 1;
    this.items = [];
    this.playing = false;
    this.closed = false;
    this.synth.cancel();
    this.set("idle");
  }

  private set(state: TtsState): void {
    if (state === this.state) return;
    this.state = state;
    this.onState(state);
  }

  private next(): void {
    if (this.playing) return;
    const text = this.items.shift();
    if (text === undefined) {
      if (this.closed) {
        this.closed = false;
        this.set("idle");
      }
      return;
    }
    this.playing = true;
    const run = this.run;
    this.synth.speak(text, (error) => {
      if (run !== this.run) return;
      this.playing = false;
      if (error) {
        this.cancel();
        this.onError(error);
        return;
      }
      this.next();
    });
  }
}

/** The browser's speech synthesis, or null where it does not exist. */
export function browserSynth(): Synth | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (typeof SpeechSynthesisUtterance === "undefined") return null;
  const synth = window.speechSynthesis;
  return {
    speak(text, done) {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => done();
      u.onerror = (e) => done(e.error || "synthesis-failed");
      synth.speak(u);
    },
    cancel: () => synth.cancel(),
  };
}

let current: (() => void) | null = null;

/** One voice at a time: starting another reading stops the one that was on. */
export function claimVoice(stop: () => void): void {
  if (current && current !== stop) current();
  current = stop;
}

export function releaseVoice(stop: () => void): void {
  if (current === stop) current = null;
}
