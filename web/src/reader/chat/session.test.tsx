import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { StoredAssistantMessage } from "./AssistantMessage";
import { CompactionNote } from "./CompactionNote";
import { MemoryPanel } from "./MemoryPanel";
import { SessionTools } from "./SessionTools";
import { type Note, type SessionApi, SessionApiError, type TraceTurn } from "./sessionApi";
import { TracePanel, toolSummary } from "./TracePanel";

afterEach(cleanup);

const mine: Note = { id: 1, text: "wants proofs", created_at: "", source: "user" };
const tutors: Note = { id: 2, text: "knows RNNs", created_at: "", source: "tutor" };

function api(over: Partial<SessionApi> = {}): SessionApi {
  return {
    notes: vi.fn(async () => [mine, tutors]),
    addNote: vi.fn(async (_i, text) => ({ id: 3, text, created_at: "", source: "user" as const })),
    editNote: vi.fn(async (_i, id, text) => ({ ...mine, id, text })),
    deleteNote: vi.fn(async () => {}),
    trace: vi.fn(async () => []),
    ...over,
  };
}

test("the notes say who wrote each one", async () => {
  render(<MemoryPanel itemId="a1" api={api()} />);
  await screen.findByText("knows RNNs");
  const row = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
  expect(within(row("wants proofs")).getByText("Written by you")).toBeTruthy();
  expect(within(row("knows RNNs")).getByText("Written by the tutor")).toBeTruthy();
  expect(screen.getByText(/2\/30/)).toBeTruthy();
});

test("a note can be edited, with Escape to give up", async () => {
  const a = api();
  render(<MemoryPanel itemId="a1" api={a} />);
  await screen.findByText("wants proofs");
  await userEvent.click(
    within(screen.getByText("wants proofs").closest("li")!).getByRole("button", {
      name: "Edit note",
    }),
  );
  const box = screen.getByRole("textbox", { name: "Edit note" });
  await userEvent.clear(box);
  await userEvent.type(box, "prefers examples");
  await userEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(a.editNote).toHaveBeenCalledWith("a1", 1, "prefers examples");
  expect(await screen.findByText("prefers examples")).toBeTruthy();
  await userEvent.click(
    within(screen.getByText("knows RNNs").closest("li")!).getByRole("button", {
      name: "Edit note",
    }),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "Edit note" })).toBeNull();
});

test("a note can be deleted and one added with Enter", async () => {
  const a = api();
  render(<MemoryPanel itemId="a1" api={a} />);
  await screen.findByText("wants proofs");
  await userEvent.click(
    within(screen.getByText("wants proofs").closest("li")!).getByRole("button", {
      name: "Delete note",
    }),
  );
  expect(a.deleteNote).toHaveBeenCalledWith("a1", 1);
  await waitFor(() => expect(screen.queryByText("wants proofs")).toBeNull());
  await userEvent.type(screen.getByRole("textbox", { name: "New note" }), "likes diagrams{Enter}");
  expect(a.addNote).toHaveBeenCalledWith("a1", "likes diagrams");
  expect(await screen.findByText("likes diagrams")).toBeTruthy();
});

test("a full memory and a failure are said plainly", async () => {
  const a = api({ addNote: vi.fn().mockRejectedValue(new SessionApiError(409, "memory_full")) });
  render(<MemoryPanel itemId="a1" api={a} />);
  await screen.findByText("wants proofs");
  await userEvent.type(screen.getByRole("textbox", { name: "New note" }), "x");
  await userEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect((await screen.findByRole("alert")).textContent).toContain("memory is full");
});

const turn = (over: Partial<TraceTurn> = {}): TraceTurn => ({
  created_at: "",
  duration_ms: 4200,
  tools: [
    { name: "search_paper", is_error: false, duration_ms: 3 },
    { name: "search_paper", is_error: false, duration_ms: 3 },
    { name: "load_artifact", is_error: true, duration_ms: 3 },
  ],
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_tokens: 5000,
  cache_write_tokens: 0,
  cost_usd: 0.0312,
  model: "m",
  stopped: false,
  error_kind: "",
  ...over,
});

test("the trace lists tools, tokens, time and cost per turn, with totals", async () => {
  render(
    <TracePanel
      itemId="a1"
      conversation={7}
      api={api({ trace: vi.fn(async () => [turn(), turn({ cost_usd: 0.5 })]) })}
    />,
  );
  expect(await screen.findByText(/2 turns · 3.0k tokens · \$0.53/)).toBeTruthy();
  expect(screen.getAllByText(/4.2s · 1.2k in · 300 out · \$0.03/)).toHaveLength(1);
  expect(screen.getAllByText(/search_paper ×2, load_artifact \(some failed\)/)).toHaveLength(2);
  expect(screen.getAllByText(/cache 5.0k read, 0 written/)).toHaveLength(2);
  expect(toolSummary([])).toBe("");
});

test("without a conversation the trace is empty and nothing is fetched", async () => {
  const a = api();
  render(<TracePanel itemId="a1" conversation={null} api={a} />);
  expect(await screen.findByText("Nothing yet.")).toBeTruthy();
  expect(a.trace).not.toHaveBeenCalled();
});

test("a trace that cannot be read says so", async () => {
  render(
    <TracePanel
      itemId="a1"
      conversation={1}
      api={api({ trace: vi.fn().mockRejectedValue(new Error("x")) })}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
});

test("the two icons open one panel at a time and Escape closes it", async () => {
  render(<SessionTools itemId="a1" conversation={1} version={0} api={api()} />);
  const memory = screen.getByRole("button", { name: "Session memory" });
  await userEvent.click(memory);
  expect(await screen.findByRole("region", { name: "Session memory" })).toBeTruthy();
  expect(memory.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "Turn trace" }));
  expect(screen.queryByRole("region", { name: "Session memory" })).toBeNull();
  expect(await screen.findByRole("region", { name: "Turn trace" })).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Turn trace" })).toBeNull();
});

test("the summary behind the compaction note can be read", async () => {
  render(<CompactionNote summary="We covered attention [p.3]." />);
  expect(screen.queryByText(/We covered/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /summarised/ }));
  expect(screen.getByText("We covered attention [p.3].")).toBeTruthy();
});

test("a refusal that can be raised offers one icon to continue", async () => {
  const onRaise = vi.fn();
  const content = {
    answer: "",
    error: { kind: "budget", message: "Budget reached.", raisable: true },
  };
  const { rerender } = render(<StoredAssistantMessage content={content} onRaise={onRaise} />);
  await userEvent.click(screen.getByRole("button", { name: "Continue with a raised limit" }));
  expect(onRaise).toHaveBeenCalledOnce();
  rerender(
    <StoredAssistantMessage
      content={{ ...content, error: { kind: "budget", message: "m" } }}
      onRaise={onRaise}
    />,
  );
  expect(screen.queryByRole("button", { name: "Continue with a raised limit" })).toBeNull();
});
