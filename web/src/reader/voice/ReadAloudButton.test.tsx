import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ReadAloudButton } from "./ReadAloudButton";
import type { Synth } from "./tts";

afterEach(cleanup);

function fake() {
  const spoken: { text: string; done(e?: string): void }[] = [];
  const synth: Synth = { speak: (text, done) => spoken.push({ text, done }), cancel: vi.fn() };
  return { synth, spoken };
}

test("nothing is shown without a voice", () => {
  const { container } = render(<ReadAloudButton text="Hi." streaming={false} synth={null} />);
  expect(container.innerHTML).toBe("");
});

test("read aloud, stop, then replay", async () => {
  const { synth, spoken } = fake();
  render(<ReadAloudButton text="Hello there." streaming={false} synth={synth} />);
  await userEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(spoken[0]?.text).toBe("Hello there.");
  await userEvent.click(screen.getByRole("button", { name: "Stop reading" }));
  expect(synth.cancel).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(spoken.map((s) => s.text)).toEqual(["Hello there.", "Hello there."]);
});

test("the button goes back to read aloud once the voice is done", async () => {
  const { synth, spoken } = fake();
  render(<ReadAloudButton text="Hello." streaming={false} synth={synth} />);
  await userEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  const { act } = await import("@testing-library/react");
  act(() => spoken[0]?.done());
  expect(screen.getByRole("button", { name: "Read aloud" })).toBeTruthy();
});
