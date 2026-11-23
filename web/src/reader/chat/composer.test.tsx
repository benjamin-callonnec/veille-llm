import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatApi, Conversation, SendBody, StoredMessage } from "./api";
import { MAX_IMAGE_BYTES, MAX_RAW_BYTES } from "./attachments";
import { ChatPane } from "./ChatPane";
import { Composer } from "./Composer";
import { resetDrafts } from "./drafts";
import { useChat } from "./useChat";

const revoked: string[] = [];
beforeEach(() => {
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => `blob:fake/${++n}`,
    revokeObjectURL: (u: string) => revoked.push(u),
  });
});
afterEach(() => {
  cleanup();
  resetDrafts();
  sessionStorage.clear();
  revoked.length = 0;
  vi.unstubAllGlobals();
});

const png = (name = "shot.png", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const clip = (files: File[], text = "") => ({
  clipboardData: { files, items: [], getData: () => text, types: files.length ? ["Files"] : [] },
});

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  const props = { onSend, onStop: vi.fn(), streaming: false, ...over };
  const view = render(<Composer {...props} />);
  return { props, onSend, view };
}

// --- paste and drop ---------------------------------------------------------------------------

test("pasting an image shows a thumbnail and inserts no text", () => {
  setup();
  fireEvent.paste(box(), clip([png()]));
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(1);
  expect(box().value).toBe("");
  expect(screen.getByRole("button", { name: "Remove image" }).textContent).toBe("");
});

test("pasting text is left alone, and text wins over a picture of it", () => {
  setup();
  const plain = fireEvent.paste(box(), clip([]));
  expect(plain).toBe(true); // not prevented: the browser inserts the text
  const mixed = fireEvent.paste(box(), clip([png()], "a,b\n1,2"));
  expect(mixed).toBe(true);
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(0);
});

test("dropping image files attaches them; other files are ignored", () => {
  setup();
  const zone = document.querySelector(".composer") as HTMLElement;
  const txt = new File(["x"], "a.txt", { type: "text/plain" });
  fireEvent.drop(zone, { dataTransfer: { files: [txt], items: [], types: ["Files"] } });
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(0);
  fireEvent.drop(zone, { dataTransfer: { files: [png()], items: [], types: ["Files"] } });
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(1);
});

test("a dropped file that is not an image is kept from replacing the page, with a quiet message", () => {
  setup();
  const zone = document.querySelector(".composer") as HTMLElement;
  const txt = new File(["x"], "a.txt", { type: "text/plain" });
  const notPrevented = fireEvent.drop(zone, {
    dataTransfer: { files: [txt], items: [], types: ["Files"] },
  });
  expect(notPrevented).toBe(false); // preventDefault was called: the browser does not open the file
  expect(screen.getByText("Only PNG, JPEG, WebP and GIF images.")).toBeTruthy();
});

test("at most four images, each under 5 MB, only png/jpeg/webp/gif, with a quiet message", () => {
  setup();
  fireEvent.paste(box(), clip([png("1"), png("2"), png("3"), png("4"), png("5")]));
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(4);
  expect(screen.getByRole("status").textContent).toMatch(/at most 4/i);
  cleanup();
  setup();
  fireEvent.paste(box(), clip([png("big", MAX_RAW_BYTES + 1)]));
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toMatch(/30 MB/);
  fireEvent.paste(box(), clip([new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })]));
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toMatch(/PNG, JPEG, WebP and GIF/);
});

test("removing an image revokes its url; an image alone can be sent with Enter", async () => {
  const { onSend } = setup();
  const file = png();
  fireEvent.paste(box(), clip([file, png("b.png")]));
  await userEvent.click(screen.getAllByRole("button", { name: "Remove image" })[0] as HTMLElement);
  expect(revoked).toEqual(["blob:fake/1"]);
  await userEvent.type(box(), "{Enter}");
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend.mock.calls[0]?.[0]).toBe("");
  expect(onSend.mock.calls[0]?.[1]).toHaveLength(1);
  expect(revoked).toContain("blob:fake/2");
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(0);
});

test("the send icon shows for an image alone", () => {
  setup();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  fireEvent.paste(box(), clip([png()]));
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});

// --- placeholders -------------------------------------------------------------------------------

test("filling the composer selects the first placeholder, Tab walks on, typing replaces", async () => {
  const text = "Compare [method A] with [method B]";
  setup({ fill: { text, n: 1 } });
  await waitFor(() => expect(box().value).toBe(text));
  expect([box().selectionStart, box().selectionEnd]).toEqual([8, 18]);
  await userEvent.keyboard("RLHF");
  expect(box().value).toBe("Compare RLHF with [method B]");
  await userEvent.tab();
  expect(box().value.slice(box().selectionStart, box().selectionEnd)).toBe("[method B]");
  await userEvent.tab({ shift: true });
  expect(document.activeElement).not.toBe(box()); // none before: the browser's own Shift+Tab
});

test("Shift+Tab goes back, and Tab is normal once no placeholder is left", async () => {
  setup({ fill: { text: "[a] and [b]", n: 1 } });
  await waitFor(() => expect(box().value).toBe("[a] and [b]"));
  await userEvent.tab();
  expect(box().value.slice(box().selectionStart, box().selectionEnd)).toBe("[b]");
  await userEvent.tab({ shift: true });
  expect(box().value.slice(box().selectionStart, box().selectionEnd)).toBe("[a]");
  await userEvent.keyboard("x");
  await userEvent.tab();
  await userEvent.keyboard("y");
  expect(box().value).toBe("x and y");
  await userEvent.tab();
  expect(document.activeElement).not.toBe(box());
});

test("a text without placeholders is not trapped by Tab", async () => {
  setup({ fill: { text: "plain question", n: 1 } });
  await waitFor(() => expect(box().value).toBe("plain question"));
  await userEvent.tab();
  expect(document.activeElement).not.toBe(box());
});

test("typed brackets do not capture Tab", async () => {
  setup();
  fireEvent.change(box(), { target: { value: "see [p.3]" } });
  box().focus();
  await userEvent.tab();
  expect(document.activeElement).not.toBe(box());
});

// --- draft ----------------------------------------------------------------------------------------

test("the draft is kept per conversation and restored when you come back", async () => {
  const { view, props } = setup({ draftKey: "c1" });
  await userEvent.type(box(), "unfinished");
  view.rerender(<Composer {...props} draftKey="c2" />);
  expect(box().value).toBe("");
  await userEvent.type(box(), "other");
  view.rerender(<Composer {...props} draftKey="c1" />);
  expect(box().value).toBe("unfinished");
});

test("the draft survives a remount and is cleared by sending", async () => {
  const first = setup({ draftKey: "c1" });
  await userEvent.type(box(), "kept");
  first.view.unmount();
  const second = setup({ draftKey: "c1" });
  expect(box().value).toBe("kept");
  await userEvent.type(box(), "{Enter}");
  expect(second.onSend).toHaveBeenCalledWith("kept");
  second.view.unmount();
  setup({ draftKey: "c1" });
  expect(box().value).toBe("");
});

// --- the chat: images in the message, suggestions --------------------------------------------------

const ID = "a".repeat(64);
const conv: Conversation = { id: 1, item_id: "a1", title: "T", created_at: "", updated_at: "" };

function chatApi(stored: StoredMessage[]) {
  const sent: SendBody[] = [];
  const api: ChatApi = {
    listConversations: async () => [conv],
    createConversation: async () => conv,
    renameConversation: async () => {},
    deleteConversation: async () => {},
    messages: async () => stored,
    exportMarkdown: async () => "",
    async *send(_i, _id, body) {
      sent.push(body);
      yield { type: "done", duration_ms: 1 };
    },
    async *regenerate() {},
  };
  return { api, sent };
}

function Host({ api }: { api: ChatApi }) {
  const chat = useChat("a1", api);
  return <ChatPane chat={chat} onGo={() => {}} />;
}

const user = (content: Record<string, unknown>): StoredMessage => ({
  id: 1,
  seq: 1,
  role: "user",
  kind: "text",
  content,
  created_at: "",
});
const answer = (content: Record<string, unknown>): StoredMessage => ({
  id: 2,
  seq: 2,
  role: "assistant",
  kind: "assistant",
  content: { answer: "Because.", blocks: [], duration_ms: 1, stopped: false, ...content },
  created_at: "",
});

test("a sent message shows its images as links to the full image, and hostile refs are dropped", async () => {
  const stored = [
    user({
      text: "what is this?",
      images: [
        { id: ID, mime: "image/png" },
        { id: "../x", mime: "image/png" },
        { id: ID, mime: "text/html" },
        { id: "", mime: "image/png", url: "javascript:alert(1)" },
      ],
    }),
  ];
  render(<Host api={chatApi(stored).api} />);
  await screen.findByText("what is this?");
  const imgs = document.querySelectorAll(".message-images img");
  expect(imgs).toHaveLength(1);
  const link = imgs[0]?.closest("a") as HTMLAnchorElement;
  expect(link.getAttribute("href")).toBe(`/api/items/a1/images/${ID}`);
  expect(link.rel).toContain("noopener");
  expect(link.target).toBe("_blank");
});

test("sending an image alone passes it, base64 encoded, to the api", async () => {
  const { api, sent } = chatApi([]);
  render(<Host api={api} />);
  const area = await screen.findByRole("textbox", { name: "Message" });
  fireEvent.paste(area, clip([png()]));
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  const body = sent[0] as Extract<SendBody, { kind: "text" }>;
  expect(body.text).toBe("");
  expect(body.images?.[0]).toMatchObject({ name: "shot.png", mime: "image/png" });
  expect(body.images?.[0]?.data).toBe("AAAAAAAAAAAAAA==");
});

test("an image still over 5 MB once scaled is not sent, and the user is told", async () => {
  const { api, sent } = chatApi([]);
  render(<Host api={api} />);
  const area = await screen.findByRole("textbox", { name: "Message" });
  fireEvent.paste(area, clip([png("huge.png", MAX_IMAGE_BYTES + 1)])); // no canvas: not scaled
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/huge\.png.*5 MB/);
  expect(sent).toHaveLength(0);
});

test("suggestions show under the last answer only, send on click, and fold away while typing", async () => {
  const stored = [
    user({ text: "q" }),
    answer({ suggestions: ["First idea?", "Why does it work?", "<b>x</b>"] }),
  ];
  const { api, sent } = chatApi(stored);
  render(<Host api={api} />);
  const chip = await screen.findByRole("button", { name: "Why does it work?" });
  expect(screen.queryByRole("button", { name: /<b>/ })).toBeNull();
  await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "a");
  expect(screen.queryByRole("button", { name: "Why does it work?" })).toBeNull();
  await userEvent.clear(screen.getByRole("textbox", { name: "Message" }));
  await userEvent.click(await screen.findByRole("button", { name: "Why does it work?" }));
  expect(chip).toBeTruthy();
  await waitFor(() => expect(sent).toEqual([{ kind: "text", text: "Why does it work?" }]));
});

test("the first suggestion is the composer's placeholder, the others are buttons: no repeat", async () => {
  const stored = [
    user({ text: "q" }),
    answer({ suggestions: ["First idea?", "Why does it work?", "What are the limits?"] }),
  ];
  render(<Host api={chatApi(stored).api} />);
  await screen.findByRole("button", { name: "Why does it work?" });
  expect(box().placeholder).toBe("First idea?");
  expect(screen.queryByRole("button", { name: "First idea?" })).toBeNull();
  expect(screen.getByRole("button", { name: "What are the limits?" })).toBeTruthy();
  expect(screen.getByText("Tab")).toBeTruthy(); // the hint sits in the composer
  await userEvent.type(box(), "a");
  expect(screen.queryByText("Tab")).toBeNull(); // gone while typing
});

test("a single suggestion is only the placeholder, with no button", async () => {
  const stored = [user({ text: "q" }), answer({ suggestions: ["Only one?"] })];
  render(<Host api={chatApi(stored).api} />);
  await screen.findAllByText("Because.");
  expect(box().placeholder).toBe("Only one?");
  expect(screen.queryByRole("button", { name: "Only one?" })).toBeNull();
});

test("a suggestion with a placeholder fills the composer instead of sending", async () => {
  const stored = [
    user({ text: "q" }),
    answer({ suggestions: ["Lead question?", "Explain [term] simply"] }),
  ];
  const { api, sent } = chatApi(stored);
  render(<Host api={api} />);
  await userEvent.click(await screen.findByRole("button", { name: "Explain [term] simply" }));
  await waitFor(() => expect(box().value).toBe("Explain [term] simply"));
  expect(box().value.slice(box().selectionStart, box().selectionEnd)).toBe("[term]");
  expect(sent).toHaveLength(0);
});

test("older answers show no suggestions", async () => {
  const stored = [
    user({ text: "q" }),
    answer({ suggestions: ["Old one?"] }),
    { ...user({ text: "q2" }), id: 3, seq: 3 },
    { ...answer({}), id: 4, seq: 4 },
  ];
  render(<Host api={chatApi(stored).api} />);
  await screen.findAllByText("Because.");
  expect(screen.queryByRole("button", { name: "Old one?" })).toBeNull();
});

// --- the / menu --------------------------------------------------------------------------

const SKILLS = [
  { name: "present", description: "Make slides.", tools: ["write_report"] },
  { name: "quiz-me", description: "Quiz.", tools: [] },
];

test("typing / opens the menu with every skill, /pre filters it", async () => {
  setup({ skills: SKILLS });
  await userEvent.type(box(), "/");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await userEvent.type(box(), "pre");
  expect(screen.getAllByRole("option")).toHaveLength(1);
});

test("arrows and Enter choose a skill: the name is put in the box, nothing is sent", async () => {
  const { onSend } = setup({ skills: SKILLS });
  await userEvent.type(box(), "/");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(box().value).toBe("/quiz-me ");
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("Tab chooses the first skill; Esc closes the menu and keeps the text", async () => {
  setup({ skills: SKILLS });
  await userEvent.type(box(), "/");
  await userEvent.keyboard("{Tab}");
  expect(box().value).toBe("/present ");
  await userEvent.clear(box());
  await userEvent.type(box(), "/q");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(box().value).toBe("/q");
});

test("sending /present with text sends the text and the skill", async () => {
  const { onSend } = setup({ skills: SKILLS });
  await userEvent.type(box(), "/present about the model{Enter}");
  expect(onSend).toHaveBeenCalledWith("about the model", undefined, false, "present");
});

test("an unknown /name is sent as plain text", async () => {
  const { onSend } = setup({ skills: SKILLS });
  await userEvent.type(box(), "/nope hello{Enter}");
  expect(onSend).toHaveBeenCalledWith("/nope hello");
});

test("without skills / is plain text: no menu, Enter sends", async () => {
  const { onSend } = setup({ skills: [] });
  await userEvent.type(box(), "/{Enter}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onSend).toHaveBeenCalledWith("/");
});

test("a /query with no match closes the menu, so Enter sends", async () => {
  const { onSend } = setup({ skills: SKILLS });
  await userEvent.type(box(), "/zzz{Enter}");
  expect(onSend).toHaveBeenCalledWith("/zzz");
});

test("Enter on an exact skill name sends it at once", async () => {
  const { onSend } = setup({ skills: SKILLS });
  await userEvent.type(box(), "/present{Enter}");
  expect(onSend).toHaveBeenCalledWith("/present", undefined, false, "present");
});

// --- the rotating placeholder ----------------------------------------------------------------

import { act } from "@testing-library/react";
import { FIRST_HINT, idleHint } from "../lib/hints";
import { HINT_FADE_MS, HINT_INTERVAL_MS } from "./useHint";

const placeholder = () => box().getAttribute("placeholder");
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const next = () => tick(HINT_INTERVAL_MS + HINT_FADE_MS);
const stubMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
const have = { skills: true, reports: false, dictation: false };

test("with no recommendation the composer opens on the invitation, then shows the tips", () => {
  vi.useFakeTimers();
  stubMotion(false);
  setup({ skills: SKILLS, speech: null });
  expect(placeholder()).toBe(FIRST_HINT);
  next();
  expect(placeholder()).toBe(idleHint(1, have));
  expect(placeholder()).not.toBe(FIRST_HINT);
  vi.useRealTimers();
});

test("a recommendation replaces the tips: they rotate between the recommendations only", () => {
  vi.useFakeTimers();
  stubMotion(false);
  setup({ recommendations: ["Why does it work?", "What are the limits?"], skills: SKILLS });
  const seen = [placeholder()];
  for (let i = 0; i < 3; i++) {
    next();
    seen.push(placeholder());
  }
  expect(seen).toEqual([
    "Why does it work?",
    "What are the limits?",
    "Why does it work?",
    "What are the limits?",
  ]);
  vi.useRealTimers();
});

test("Tab fills the recommendation that is shown, and the Tab key badge is only there for one", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stubMotion(false);
  const { view, props } = setup({ recommendations: ["First?", "Second?"] });
  expect(screen.getByText("Tab")).toBeTruthy();
  next();
  expect(placeholder()).toBe("Second?");
  box().focus();
  await userEvent.keyboard("{Tab}");
  expect(box().value).toBe("Second?");
  view.rerender(<Composer {...props} recommendations={[]} />);
  fireEvent.change(box(), { target: { value: "" } });
  expect(screen.queryByText("Tab")).toBeNull();
  vi.useRealTimers();
});

test("a single recommendation stays: nothing rotates", () => {
  vi.useFakeTimers();
  stubMotion(false);
  setup({ recommendations: ["Only one?"] });
  expect(vi.getTimerCount()).toBe(0);
  tick(3 * (HINT_INTERVAL_MS + HINT_FADE_MS));
  expect(placeholder()).toBe("Only one?");
  vi.useRealTimers();
});

test("new recommendations start again from the first one", () => {
  vi.useFakeTimers();
  stubMotion(false);
  const { view, props } = setup({ recommendations: ["A?", "B?"] });
  next();
  expect(placeholder()).toBe("B?");
  view.rerender(<Composer {...props} recommendations={["C?", "D?"]} />);
  expect(placeholder()).toBe("C?");
  vi.useRealTimers();
});

test("nothing rotates while you type, while it answers, or with reduced motion", () => {
  vi.useFakeTimers();
  stubMotion(false);
  const { view, props } = setup({ skills: SKILLS });
  fireEvent.change(box(), { target: { value: "hello" } });
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.change(box(), { target: { value: "" } });
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.rerender(<Composer {...props} streaming />);
  expect(vi.getTimerCount()).toBe(0);
  expect(placeholder()).toBe("Answering…");
  cleanup();
  stubMotion(true);
  setup({ skills: SKILLS });
  expect(vi.getTimerCount()).toBe(0);
  expect(placeholder()).toBe(FIRST_HINT);
  vi.useRealTimers();
});

test("tips about reports and dictation show only when they exist", () => {
  vi.useFakeTimers();
  stubMotion(false);
  setup({ hasReports: true, speech: null });
  const seen: string[] = [];
  for (let i = 0; i < 15; i++) {
    next();
    seen.push(placeholder() ?? "");
  }
  expect(seen.some((t) => t.includes("reports"))).toBe(true);
  expect(seen.some((t) => t.includes("microphone"))).toBe(false); // no speech engine here
  expect(seen.some((t) => t.includes("Type / for commands"))).toBe(false); // no skills here
  vi.useRealTimers();
});

test("the timers are cleared when the composer goes away", () => {
  vi.useFakeTimers();
  stubMotion(false);
  const { view } = setup({ skills: SKILLS });
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
