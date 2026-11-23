import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { SttEngine, SttHandlers } from "../voice/stt";
import { Composer } from "./Composer";
import { resetDrafts } from "./drafts";

afterEach(() => {
  cleanup();
  resetDrafts();
  sessionStorage.clear();
});

function fakeEngine() {
  let handlers: SttHandlers | null = null;
  const engine: SttEngine = {
    start: vi.fn((h) => {
      handlers = h;
    }),
    stop: vi.fn(() => handlers?.onEnd()),
  };
  return { engine, h: () => handlers as SttHandlers };
}
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

function setup(speech: SttEngine | null) {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} onStop={vi.fn()} streaming={false} speech={speech} />);
  return { onSend };
}

test("no microphone button where speech is not supported", () => {
  setup(null);
  expect(screen.queryByRole("button", { name: /dictat/i })).toBeNull();
});

test("nothing listens until the button is clicked", () => {
  const { engine } = fakeEngine();
  setup(engine);
  expect(engine.start).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Dictate" })).toBeTruthy();
});

test("the live transcript shows in the composer, the final text stays editable", async () => {
  const { engine, h } = fakeEngine();
  setup(engine);
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  expect(engine.start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Stop dictation" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  act(() => h().onPartial("hello wor"));
  expect(box().value).toBe("hello wor");
  act(() => h().onFinal("hello world"));
  act(() => h().onPartial("and more"));
  expect(box().value).toBe("hello world and more");
  await userEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
  expect(engine.stop).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Dictate" })).toBeTruthy();
  await userEvent.type(box(), "!");
  expect(box().value).toBe("hello world and more!");
});

test("dictation appends to what was already typed", async () => {
  const { engine, h } = fakeEngine();
  setup(engine);
  await userEvent.type(box(), "Why");
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  act(() => h().onFinal("is it so"));
  expect(box().value).toBe("Why is it so");
});

test("typing while dictating keeps the words so far and stops listening", async () => {
  const { engine, h } = fakeEngine();
  setup(engine);
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  act(() => h().onPartial("hello"));
  await userEvent.type(box(), "!");
  expect(engine.stop).toHaveBeenCalled();
  expect(box().value).toBe("hello!");
});

test("sending is possible once words were dictated, and it stops the microphone", async () => {
  const { engine, h } = fakeEngine();
  const { onSend } = setup(engine);
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  act(() => h().onFinal("what is attention"));
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(onSend).toHaveBeenCalledWith("what is attention");
  expect(engine.stop).toHaveBeenCalled();
  expect(box().value).toBe("");
});

test("a denied microphone says so, quietly, and stops", async () => {
  const { engine, h } = fakeEngine();
  setup(engine);
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  act(() => h().onError("denied"));
  act(() => h().onEnd());
  expect(screen.getByRole("status").textContent).toMatch(/microphone is blocked/i);
  expect(screen.getByRole("button", { name: "Dictate" })).toBeTruthy();
});

test("an unfinished phrase is kept when listening ends", async () => {
  const { engine, h } = fakeEngine();
  setup(engine);
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  act(() => h().onPartial("almost done"));
  act(() => h().onEnd());
  expect(box().value).toBe("almost done");
});

test("the microphone is not offered while the tutor answers", () => {
  const { engine } = fakeEngine();
  render(<Composer onSend={vi.fn()} onStop={vi.fn()} streaming speech={engine} />);
  expect(screen.queryByRole("button", { name: /dictat/i })).toBeNull();
});

test("leaving the page turns the microphone off", async () => {
  const { engine } = fakeEngine();
  const view = render(
    <Composer onSend={vi.fn()} onStop={vi.fn()} streaming={false} speech={engine} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
  view.unmount();
  expect(engine.stop).toHaveBeenCalled();
});
