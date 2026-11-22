import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatApi, Conversation, SendBody, StoredMessage } from "./api";
import { MAX_IMAGE_BYTES } from "./attachments";
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

test("at most four images, each under 5 MB, only png/jpeg/webp/gif, with a quiet message", () => {
  setup();
  fireEvent.paste(box(), clip([png("1"), png("2"), png("3"), png("4"), png("5")]));
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(4);
  expect(screen.getByRole("status").textContent).toMatch(/at most 4/i);
  cleanup();
  setup();
  fireEvent.paste(box(), clip([png("big", MAX_IMAGE_BYTES + 1)]));
  expect(document.querySelectorAll(".composer-images img")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toMatch(/5 MB/);
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

test("suggestions show under the last answer only, send on click, and fold away while typing", async () => {
  const stored = [user({ text: "q" }), answer({ suggestions: ["Why does it work?", "<b>x</b>"] })];
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

test("a suggestion with a placeholder fills the composer instead of sending", async () => {
  const stored = [user({ text: "q" }), answer({ suggestions: ["Explain [term] simply"] })];
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
