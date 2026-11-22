import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantMessage, StoredAssistantMessage } from "./AssistantMessage";
import type { StoredMessage } from "./api";
import { Composer } from "./Composer";
import { UserMessage } from "./UserMessage";

afterEach(cleanup);

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

test("a stopped answer says so", () => {
  render(
    <StoredAssistantMessage
      content={{ answer: "half", blocks: [], duration_ms: 1, stopped: true }}
      onCite={() => {}}
    />,
  );
  expect(screen.getByText(/stopped/i)).toBeTruthy();
});

test("a live answer follows the open state it is given", () => {
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
});

test("composer: Enter sends, Shift+Enter adds a line, empty is disabled", async () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} onStop={() => {}} streaming={false} />);
  const box = screen.getByRole("textbox", { name: "Message" });
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
  expect((box as HTMLTextAreaElement).value).toBe("line one\nline two");
  await userEvent.keyboard("{Enter}");
  expect(onSend).toHaveBeenCalledWith("line one\nline two");
  expect((box as HTMLTextAreaElement).value).toBe("");
  await userEvent.type(box, "   {Enter}");
  expect(onSend).toHaveBeenCalledTimes(1);
});

test("composer: Stop replaces Send while streaming", async () => {
  const onStop = vi.fn();
  render(<Composer onSend={() => {}} onStop={onStop} streaming={true} />);
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalled();
});
