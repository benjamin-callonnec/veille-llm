import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Synth } from "./tts";
import { useReadAloud } from "./useReadAloud";

function fakeSynth() {
  const spoken: { text: string; done(error?: string): void }[] = [];
  const synth: Synth = { speak: (text, done) => spoken.push({ text, done }), cancel: vi.fn() };
  return { synth, spoken };
}
const texts = (s: { text: string }[]) => s.map((x) => x.text);

test("a finished answer is read sentence by sentence, citations left out", () => {
  const { synth, spoken } = fakeSynth();
  const { result } = renderHook(() =>
    useReadAloud('It works [p.2 "a quote here"]. Then **more**.', false, synth),
  );
  expect(result.current.active).toBe(false);
  act(() => result.current.toggle());
  expect(result.current.active).toBe(true);
  expect(texts(spoken)).toEqual(["It works."]);
  act(() => spoken[0]?.done());
  expect(texts(spoken)).toEqual(["It works.", "Then more."]);
  act(() => spoken[1]?.done());
  expect(result.current.active).toBe(false);
});

test("while the answer streams, new sentences are spoken as they complete", () => {
  const { synth, spoken } = fakeSynth();
  const { result, rerender } = renderHook(
    ({ text, streaming }) => useReadAloud(text, streaming, synth),
    { initialProps: { text: "First one. Seco", streaming: true } },
  );
  act(() => result.current.toggle());
  expect(texts(spoken)).toEqual(["First one."]);
  rerender({ text: "First one. Second one. Thi", streaming: true });
  act(() => spoken[0]?.done());
  expect(texts(spoken)).toEqual(["First one.", "Second one."]);
  act(() => spoken[1]?.done());
  expect(result.current.active).toBe(true); // more may come
  rerender({ text: "First one. Second one. Third", streaming: false });
  expect(texts(spoken)).toEqual(["First one.", "Second one.", "Third"]);
  act(() => spoken[2]?.done());
  expect(result.current.active).toBe(false);
});

test("stop cuts the voice; clicking again replays from the start", () => {
  const { synth, spoken } = fakeSynth();
  const { result } = renderHook(() => useReadAloud("One. Two.", false, synth));
  act(() => result.current.toggle());
  act(() => result.current.toggle());
  expect(result.current.active).toBe(false);
  expect(synth.cancel).toHaveBeenCalled();
  act(() => result.current.toggle());
  expect(texts(spoken)).toEqual(["One.", "One."]);
});

test("nothing is supported without a voice", () => {
  const { result } = renderHook(() => useReadAloud("One.", false, null));
  expect(result.current.supported).toBe(false);
});

test("starting a second reading stops the first", () => {
  const a = fakeSynth();
  const b = fakeSynth();
  const first = renderHook(() => useReadAloud("One.", false, a.synth));
  const second = renderHook(() => useReadAloud("Two.", false, b.synth));
  act(() => first.result.current.toggle());
  act(() => second.result.current.toggle());
  expect(first.result.current.active).toBe(false);
  expect(second.result.current.active).toBe(true);
});

test("a voice failure is reported", () => {
  const { synth, spoken } = fakeSynth();
  const { result } = renderHook(() => useReadAloud("One.", false, synth));
  act(() => result.current.toggle());
  act(() => spoken[0]?.done("synthesis-failed"));
  expect(result.current.active).toBe(false);
  expect(result.current.error).toMatch(/read aloud/i);
});

test("unmounting stops the voice", () => {
  const { synth } = fakeSynth();
  const { result, unmount } = renderHook(() => useReadAloud("One.", false, synth));
  act(() => result.current.toggle());
  unmount();
  expect(synth.cancel).toHaveBeenCalled();
});

test("an answer with nothing to say does not stay active", () => {
  const { synth } = fakeSynth();
  const { result } = renderHook(() => useReadAloud("[p.3]", false, synth));
  act(() => result.current.toggle());
  expect(result.current.active).toBe(false);
});

test("leaving while the answer streams (it was just stored) says the rest", () => {
  const { synth, spoken } = fakeSynth();
  const { result, unmount } = renderHook(() => useReadAloud("One. Two", true, synth));
  act(() => result.current.toggle());
  unmount();
  expect(synth.cancel).not.toHaveBeenCalled();
  act(() => spoken[0]?.done());
  expect(texts(spoken)).toEqual(["One.", "Two"]);
});
