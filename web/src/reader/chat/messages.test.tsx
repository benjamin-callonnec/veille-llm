import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantMessage, StoredAssistantMessage } from "./AssistantMessage";
import type { StoredMessage } from "./api";
import { Composer } from "./Composer";
import { resetDrafts } from "./drafts";
import { applyEvent, initialAssistant } from "./reducer";
import { UserMessage } from "./UserMessage";

const writeText = vi.fn(async () => {});

beforeEach(() => {
  sessionStorage.clear();
  resetDrafts(); // an earlier test may have left an unsent draft
  writeText.mockClear();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const msg = (over: Partial<StoredMessage>): StoredMessage => ({
  id: 1,
  seq: 1,
  role: "user",
  kind: "text",
  content: { text: "hello" },
  created_at: "",
  ...over,
});

test("a plain user message is a bubble of text", () => {
  render(<UserMessage message={msg({ content: { text: "<b>hi</b>" } })} onGo={() => {}} />);
  expect(screen.getByText("<b>hi</b>")).toBeTruthy();
  expect(document.querySelector("b")).toBeNull();
});

test("an ask_agent message shows the quote, its page and jumps back to the PDF", async () => {
  const onGo = vi.fn();
  render(
    <UserMessage
      message={msg({
        kind: "ask_agent",
        content: { quote: { text: "a passage", page: 4, rects: [] }, question: "why?" },
      })}
      onGo={onGo}
    />,
  );
  expect(screen.getByText("a passage")).toBeTruthy();
  expect(screen.getByText("why?")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Go to page 4" }));
  expect(onGo).toHaveBeenCalledWith(4, []);
});

test("the quote of a question goes back to its stored rects", async () => {
  const onGo = vi.fn();
  const rects = [[0.1, 0.2, 0.3, 0.04]];
  render(
    <UserMessage
      message={msg({
        kind: "ask_agent",
        content: { quote: { text: "a passage", page: 4, rects }, question: "why?" },
      })}
      onGo={onGo}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Go to page 4" }));
  expect(onGo).toHaveBeenCalledWith(4, rects);
});

test("a user message has its day, retry and copy as icons in a hover-revealed row", async () => {
  const onRetry = vi.fn();
  const { container } = render(
    <UserMessage
      message={msg({ created_at: "2026-11-11T09:30:00Z" })}
      onGo={() => {}}
      onRetry={onRetry}
    />,
  );
  const row = container.querySelector(".msg-actions");
  expect(row).not.toBeNull();
  expect(row?.textContent).toContain("Nov 11");
  const retry = screen.getByRole("button", { name: "Retry" });
  const copy = screen.getByRole("button", { name: "Copy" });
  expect(retry.textContent).toBe("");
  expect(copy.textContent).toBe("");
  await userEvent.click(retry);
  expect(onRetry).toHaveBeenCalledTimes(1);
  await userEvent.click(copy);
  expect(writeText).toHaveBeenCalledWith("hello");
});

test("copying says so: the icon turns into a check", async () => {
  render(<UserMessage message={msg({})} onGo={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
});

test("without a retry handler there is no retry icon, and without a date no date", () => {
  const { container } = render(<UserMessage message={msg({})} onGo={() => {}} />);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(container.querySelector(".msg-time")).toBeNull();
});

test("copying an ask_agent message copies the question, not the quote", async () => {
  render(
    <UserMessage
      message={msg({
        kind: "ask_agent",
        content: { quote: { text: "a passage", page: 4, rects: [] }, question: "why?" },
      })}
      onGo={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("why?");
});

test("a stored answer shows its thinking folded, reopenable, and the answer as markdown", async () => {
  render(
    <StoredAssistantMessage
      content={{
        answer: "See [p.2]",
        blocks: [{ type: "thinking", text: "private reasoning" }],
        duration_ms: 3000,
        stopped: false,
      }}
      onCite={() => {}}
    />,
  );
  expect(screen.queryByText("private reasoning")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Thought for 3s/ }));
  expect(screen.getByText("private reasoning")).toBeTruthy();
  expect(screen.getByRole("button", { name: "p.2" })).toBeTruthy();
});

test("an answer has a copy icon and how long ago it was written, and no text buttons", async () => {
  const { container } = render(
    <StoredAssistantMessage
      content={{ answer: "the **answer**", blocks: [], duration_ms: 1, stopped: false }}
      createdAt="2026-11-08T12:00:00Z"
      now={Date.parse("2026-11-22T12:00:00Z")}
      onCite={() => {}}
    />,
  );
  expect(container.querySelector(".msg-actions")?.textContent).toContain("2 weeks ago");
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("the **answer**");
  expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  expect(screen.queryByText("Regenerate")).toBeNull();
});

test("an answer with no text has nothing to copy", () => {
  render(
    <StoredAssistantMessage
      content={{ answer: "", blocks: [], duration_ms: 1, stopped: true }}
      onCite={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
});

test("a budget error shows the server's own message, not the subscription text", () => {
  render(
    <StoredAssistantMessage
      content={{
        answer: "",
        blocks: [],
        duration_ms: 1,
        stopped: false,
        error: { kind: "budget", message: "This conversation reached its budget." },
      }}
      onCite={() => {}}
    />,
  );
  const alert = screen.getByRole("alert").textContent ?? "";
  expect(alert).toBe("This conversation reached its budget.");
  expect(alert).not.toMatch(/subscription/i);
});

test("limit and failure errors read clearly and keep the partial answer", () => {
  const { rerender } = render(
    <StoredAssistantMessage
      content={{
        answer: "partial",
        blocks: [],
        duration_ms: 1,
        stopped: false,
        error: { kind: "limit", message: "x" },
      }}
      onCite={() => {}}
    />,
  );
  expect(screen.getByText("partial")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/limit/i);
  rerender(
    <StoredAssistantMessage
      content={{
        answer: "",
        blocks: [],
        duration_ms: 1,
        stopped: false,
        error: { kind: "failed", message: "boom" },
      }}
      onCite={() => {}}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("boom");
});

test("an authentication error shows its instructions as plain text", () => {
  render(
    <StoredAssistantMessage
      content={{
        answer: "",
        blocks: [],
        duration_ms: 1,
        stopped: false,
        error: {
          kind: "auth",
          message: "Claude could not authenticate this session. Run `make reader-token` <b>now</b>",
        },
      }}
      onCite={() => {}}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("make reader-token");
  expect(alert.textContent).toContain("<b>now</b>");
  expect(document.querySelector("b")).toBeNull();
});

test("a stopped answer says so", () => {
  render(
    <StoredAssistantMessage
      content={{ answer: "half", blocks: [], duration_ms: 1, stopped: true }}
      onCite={() => {}}
    />,
  );
  expect(screen.getByText(/stopped/i)).toBeTruthy();
});

test("a live answer follows the open state it is given and has no action yet", () => {
  render(
    <AssistantMessage
      state={{
        blocks: [{ type: "thinking", text: "live reasoning" }],
        answer: "",
        thinkingOpen: true,
        userToggled: false,
        startedAt: 0,
        durationMs: null,
        status: "streaming",
      }}
      onToggleThinking={() => {}}
      onCite={() => {}}
    />,
  );
  expect(screen.getByText("live reasoning")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
});

// --- composer -------------------------------------------------------------------------------

const composer = (over: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const props = { onSend: vi.fn(), onStop: vi.fn(), streaming: false, ...over };
  render(<Composer {...props} />);
  return props;
};
const box = () => screen.getByRole("textbox", { name: "Message" });

test("an empty composer shows only its placeholder: no send icon", () => {
  composer();
  expect(box().getAttribute("placeholder")).toBe("Ask about the paper…");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("typing makes the send icon appear, and it sends", async () => {
  const p = composer();
  await userEvent.type(box(), "hello");
  const send = screen.getByRole("button", { name: "Send" });
  expect(send.textContent).toBe("");
  await userEvent.click(send);
  expect(p.onSend).toHaveBeenCalledWith("hello");
  expect((box() as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

test("Enter sends, Shift+Enter adds a line, blank text sends nothing and shows no icon", async () => {
  const p = composer();
  await userEvent.type(box(), "line one{Shift>}{Enter}{/Shift}line two");
  expect((box() as HTMLTextAreaElement).value).toBe("line one\nline two");
  await userEvent.keyboard("{Enter}");
  expect(p.onSend).toHaveBeenCalledWith("line one\nline two");
  await userEvent.type(box(), "   {Enter}");
  expect(p.onSend).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

test("while the answer streams the stop icon replaces send, and Enter sends nothing", async () => {
  const p = composer({ streaming: true });
  await userEvent.type(box(), "next{Enter}");
  expect(p.onSend).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  const stop = screen.getByRole("button", { name: "Stop" });
  expect(stop.textContent).toBe("");
  await userEvent.click(stop);
  expect(p.onStop).toHaveBeenCalled();
});

test("the composer has no plus: that control is kept for attachments and audio", () => {
  composer();
  expect(screen.queryByRole("button", { name: "New conversation" })).toBeNull();
  expect(document.querySelector(".composer-new")).toBeNull();
});

test("the model is shown quietly under the composer", () => {
  composer({ model: "Sonnet 5.5" });
  expect(screen.getByText("Sonnet 5.5")).toBeTruthy();
  cleanup();
  const { container } = render(<Composer onSend={() => {}} onStop={() => {}} streaming={false} />);
  expect(container.querySelector(".composer-status")).toBeNull();
});

test("stored citations mark a doubtful chip, and malformed ones are ignored", () => {
  render(
    <StoredAssistantMessage
      content={{
        answer: 'See [p.2 "not in the paper"] and [p.3]',
        citations: [
          { page: 2, quote: "not in the paper", status: "unverified", section: null },
          { page: "x" },
        ] as never,
      }}
      onCite={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "p.2" }).className).toContain("cite-doubt");
  expect(screen.getByRole("button", { name: "p.3" }).className).toBe("cite");
});

test("a live answer uses the citations event of the stream", async () => {
  const onCite = vi.fn();
  const state = {
    ...initialAssistant(0),
    answer: 'See [p.2 "a stated quote"]',
    citations: [
      {
        page: 2,
        quote: "a stated quote",
        status: "wrong_page" as const,
        section: null,
        found_page: 6,
      },
    ],
  };
  render(<AssistantMessage state={state} onToggleThinking={() => {}} onCite={onCite} />);
  await userEvent.click(screen.getByRole("button", { name: "p.2" }));
  expect(onCite).toHaveBeenCalledWith(6, "a stated quote");
});

test("Tab on an empty composer fills it with the suggested prompt, and Enter sends it", async () => {
  const props = composer({ tabFill: "Why divide by the square root of d_k?" });
  box().focus();
  await userEvent.tab();
  expect((box() as HTMLTextAreaElement).value).toBe("Why divide by the square root of d_k?");
  expect(document.activeElement).toBe(box()); // focus stays in the composer
  await userEvent.keyboard("{Enter}");
  expect(props.onSend).toHaveBeenCalledWith("Why divide by the square root of d_k?");
});

test("Tab selects the first [placeholder] of a suggestion it fills", async () => {
  composer({ tabFill: "Explain the intuition behind [equation]" });
  box().focus();
  await userEvent.tab();
  const area = box() as HTMLTextAreaElement;
  expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe("[equation]");
});

test("Tab does nothing special once something is typed", async () => {
  composer({ tabFill: "A suggestion" });
  await userEvent.type(box(), "my own");
  await userEvent.tab();
  expect((box() as HTMLTextAreaElement).value).toBe("my own");
});

test("Tab does nothing special when there is no suggestion", async () => {
  composer();
  box().focus();
  await userEvent.tab();
  expect((box() as HTMLTextAreaElement).value).toBe("");
});

// --- the timer and the dots of an answer being produced ----------------------------------

const timerText = () => screen.queryByLabelText("Elapsed time")?.textContent ?? null;

test("a timer runs under the whole answer, even when thinking is folded and the text arrives", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
  const start = Date.now();
  let state = initialAssistant(start);
  state = applyEvent(state, { type: "thinking_delta", text: "hm" }, start);
  state = applyEvent(state, { type: "text_delta", text: "The answer starts" }, start); // folds thinking
  expect(state.thinkingOpen).toBe(false);
  render(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(timerText()).toBe("0:00");
  act(() => {
    vi.advanceTimersByTime(9000);
  });
  expect(timerText()).toBe("0:09");
  vi.useRealTimers();
});

test("the dots keep moving for as long as the agent works: thinking, a tool call, text, more tools", () => {
  const t0 = 1_000;
  const moving = () => document.querySelector(".thinking-dots")?.classList.contains("moving");
  let state = initialAssistant(t0);
  const { rerender } = render(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(moving()).toBe(true); // just sent: already working
  state = applyEvent(state, { type: "thinking_delta", text: "hm" }, t0);
  rerender(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(moving()).toBe(true);
  state = applyEvent(state, { type: "text_delta", text: "Let me look at the paper." }, t0);
  rerender(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(moving()).toBe(true); // text came, but the agent is not done
  state = applyEvent(state, { type: "tool_use", id: "t", name: "write_report", input: {} }, t0);
  rerender(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(moving()).toBe(true); // a long tool call is still work, never a frozen dot
});

test("the dots stand still while the agent waits for your answer, and stop when it is done", () => {
  const t0 = 1_000;
  const moving = () => document.querySelector(".thinking-dots")?.classList.contains("moving");
  let state = initialAssistant(t0);
  state = applyEvent(
    state,
    { type: "ask_user", id: "a", question: "Who is it for?", options: [], timeout_s: 120 },
    t0,
  );
  const { rerender } = render(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(moving()).toBe(false); // waiting for you is not working
  state = applyEvent(state, { type: "ask_resolved", id: "a", status: "answered", answer: "x" }, t0);
  rerender(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(moving()).toBe(true);
  state = applyEvent(state, { type: "done", duration_ms: 5 }, t0);
  rerender(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(document.querySelector(".thinking-dots")).toBeNull();
});

test("the dots come before the label; the timer belongs to the whole message, not to Thinking", () => {
  render(<AssistantMessage state={initialAssistant(Date.now())} onToggleThinking={() => {}} />);
  const toggle = document.querySelector(".thinking-toggle") as HTMLElement;
  expect(toggle.firstElementChild).toBe(document.querySelector(".thinking-dots")); // before the word
  const clock = document.querySelector(".turn-assistant > .turn-clock") as HTMLElement;
  expect(clock.querySelector('[aria-label="Elapsed time"]')).not.toBeNull();
  expect(document.querySelector('.thinking [aria-label="Elapsed time"]')).toBeNull();
  expect(document.querySelector(".answer-status")).toBeNull();
});

test("the timer stays on the message when thinking is folded, while the text arrives", () => {
  let state = initialAssistant(Date.now());
  state = applyEvent(state, { type: "text_delta", text: "The answer starts" }, Date.now());
  render(<AssistantMessage state={state} onToggleThinking={() => {}} />);
  expect(document.querySelector(".turn-assistant > .turn-clock")).not.toBeNull();
});

test("a finished message has no running clock on its bubble", () => {
  render(<StoredAssistantMessage content={{ answer: "Done.", blocks: [], duration_ms: 4000 }} />);
  expect(document.querySelector(".turn-clock")).toBeNull();
});

test("a stored answer shows how long it took, with the quiet actions, and no timer ticks", () => {
  vi.useFakeTimers();
  render(<StoredAssistantMessage content={{ answer: "Done.", blocks: [], duration_ms: 65_000 }} />);
  expect(timerText()).toBe("1:05");
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

test("a stored answer without a duration shows nothing", () => {
  render(<StoredAssistantMessage content={{ answer: "Done.", blocks: [] }} />);
  expect(timerText()).toBeNull();
});
