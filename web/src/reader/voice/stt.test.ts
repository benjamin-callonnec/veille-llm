import { afterEach, expect, test, vi } from "vitest";
import { browserStt, messageOf } from "./stt";

afterEach(() => vi.unstubAllGlobals());

type Handler = ((e: unknown) => void) | null;
class FakeRecognition {
  static last: FakeRecognition;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  started = 0;
  stopped = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
    this.onend?.({});
  }
}
const result = (text: string, isFinal: boolean) =>
  Object.assign([{ transcript: text }], { isFinal });
const event = (resultIndex: number, ...results: ReturnType<typeof result>[]) => ({
  resultIndex,
  results,
});

test("no engine where the browser has no speech recognition", () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  expect(browserStt()).toBeNull();
});

test("interim results are partials, final ones are committed once", () => {
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  const engine = browserStt("en-US");
  const h = { onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
  engine?.start(h);
  const rec = FakeRecognition.last;
  expect(rec.started).toBe(1);
  expect(rec.interimResults).toBe(true);
  expect(rec.lang).toBe("en-US");
  rec.onresult?.(event(0, result("hel", false)));
  expect(h.onPartial).toHaveBeenLastCalledWith("hel");
  rec.onresult?.(event(0, result("hello", true), result("wor", false)));
  expect(h.onFinal).toHaveBeenCalledWith("hello");
  expect(h.onPartial).toHaveBeenLastCalledWith("wor");
  rec.onresult?.(event(1, result("hello", true), result("world", true)));
  expect(h.onFinal).toHaveBeenLastCalledWith("world");
  engine?.stop();
  expect(h.onEnd).toHaveBeenCalledTimes(1);
});

test("errors are mapped to clear kinds", () => {
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  const h = { onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
  browserStt()?.start(h);
  FakeRecognition.last.onerror?.({ error: "not-allowed" });
  expect(h.onError).toHaveBeenCalledWith("denied");
  FakeRecognition.last.onerror?.({ error: "no-speech" });
  expect(h.onError).toHaveBeenLastCalledWith("no-speech");
  FakeRecognition.last.onerror?.({ error: "aborted" }); // our own stop: not an error
  expect(h.onError).toHaveBeenCalledTimes(2);
  FakeRecognition.last.onerror?.({ error: "network" });
  expect(h.onError).toHaveBeenLastCalledWith("network");
});

test("start failing (already started) is an error, not a crash", () => {
  class Throwing extends FakeRecognition {
    start() {
      throw new Error("InvalidStateError");
    }
  }
  vi.stubGlobal("webkitSpeechRecognition", Throwing);
  const h = { onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
  browserStt()?.start(h);
  expect(h.onError).toHaveBeenCalledWith("other");
  expect(h.onEnd).toHaveBeenCalled();
});

test("each error has a plain message", () => {
  expect(messageOf("denied")).toMatch(/microphone.*(denied|blocked)/i);
  expect(messageOf("no-speech")).toMatch(/hear/i);
  expect(messageOf("network")).toMatch(/internet/i);
  expect(messageOf("other")).toMatch(/dictation/i);
});
