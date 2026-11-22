import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantMessage, StoredAssistantMessage } from "./AssistantMessage";
import type { StoredMessage } from "./api";
import { Composer } from "./Composer";
import { resetDrafts } from "./drafts";
import { initialAssistant } from "./reducer";
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
  expect(onGo).toHaveBeenCalledWith(4);
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
