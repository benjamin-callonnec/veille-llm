import { expect, test, vi } from "vitest";
import { type Synth, TtsQueue } from "./tts";

/** A fake voice: utterances are kept so a test decides when each one ends. */
function fakeSynth() {
  const spoken: { text: string; done(error?: string): void }[] = [];
  const synth: Synth = {
    speak: (text, done) => spoken.push({ text, done }),
    cancel: vi.fn(),
  };
  return { synth, spoken };
}

test("sentences are spoken one at a time, in order", () => {
  const { synth, spoken } = fakeSynth();
  const q = new TtsQueue(synth);
  q.enqueue("One.");
  q.enqueue("Two.");
  expect(spoken.map((s) => s.text)).toEqual(["One."]);
  spoken[0]?.done();
  expect(spoken.map((s) => s.text)).toEqual(["One.", "Two."]);
});

test("it reports speaking, then idle once the last sentence of a finished queue ends", () => {
  const { synth, spoken } = fakeSynth();
  const states: string[] = [];
  const q = new TtsQueue(synth, (s) => states.push(s));
  q.enqueue("One.");
  spoken[0]?.done();
  expect(q.state).toBe("speaking"); // still waiting for more text: the answer streams
  q.finish();
  expect(q.state).toBe("idle");
  expect(states).toEqual(["speaking", "idle"]);
});

test("finish with nothing pending goes idle at once", () => {
  const { synth } = fakeSynth();
  const q = new TtsQueue(synth);
  q.finish();
  expect(q.state).toBe("idle");
});

test("cancel stops the voice, drops the queue and ignores the late end of the old sentence", () => {
  const { synth, spoken } = fakeSynth();
  const q = new TtsQueue(synth);
  q.enqueue("One.");
  q.enqueue("Two.");
  q.cancel();
  expect(synth.cancel).toHaveBeenCalled();
  expect(q.state).toBe("idle");
  spoken[0]?.done("canceled"); // browsers report the cancel as an end
  expect(spoken).toHaveLength(1);
});

test("the queue can be reused after a cancel (replay)", () => {
  const { synth, spoken } = fakeSynth();
  const q = new TtsQueue(synth);
  q.enqueue("One.");
  q.cancel();
  q.enqueue("Again.");
  expect(spoken.map((s) => s.text)).toEqual(["One.", "Again."]);
  spoken[0]?.done(); // the stale end must not advance the new run
  expect(q.state).toBe("speaking");
  spoken[1]?.done();
  q.finish();
  expect(q.state).toBe("idle");
});

test("a failing sentence is reported and stops the run", () => {
  const { synth, spoken } = fakeSynth();
  const onError = vi.fn();
  const q = new TtsQueue(synth, undefined, onError);
  q.enqueue("One.");
  q.enqueue("Two.");
  spoken[0]?.done("synthesis-failed");
  expect(onError).toHaveBeenCalledWith("synthesis-failed");
  expect(q.state).toBe("idle");
  expect(spoken).toHaveLength(1);
});

test("the browser voice speaks at the chosen speed", async () => {
  const spoken: { rate: number }[] = [];
  class Utterance {
    rate = 1;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak: (u: { rate: number }) => spoken.push(u),
    cancel: vi.fn(),
  });
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
  });
  const { browserSynth } = await import("./tts");
  const { saveSpeed } = await import("../../lib/speechRate");
  saveSpeed(localStorage, "slow");
  browserSynth()?.speak("Hello.", () => {});
  saveSpeed(localStorage, "fast");
  browserSynth()?.speak("Hello.", () => {});
  vi.unstubAllGlobals();
  expect(spoken.map((u) => u.rate)).toEqual([0.8, 1.3]);
});
