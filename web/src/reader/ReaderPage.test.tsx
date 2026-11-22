import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatApi, StoredMessage } from "./chat/api";
import { FakeSource } from "./pdf/fakeSource";
import { PdfOpenError, type PdfSource } from "./pdf/source";
import { type ReaderItem, ReaderPage } from "./ReaderPage";
import type { Highlight, HighlightsApi } from "./useHighlights";

const item = (over: Partial<ReaderItem> = {}): ReaderItem => ({
  id: "a1",
  title: "Agents at scale",
  hook: "A bold hook.",
  url: "https://arxiv.org/abs/2401.01234",
  type: "paper",
  has_pdf: true,
  ...over,
});

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  window.location.hash = "";
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fakeChatApi = (reply = "Streamed answer [p.3]", hold?: Promise<void>) => {
  const messages: StoredMessage[] = [];
  const sent: unknown[] = [];
  const api: ChatApi = {
    listConversations: async () => [],
    createConversation: async (_i, title) => ({
      id: 1,
      item_id: "a1",
      title,
      created_at: "",
      updated_at: "",
    }),
    renameConversation: async () => {},
    deleteConversation: async () => {},
    messages: async () => [...messages],
    exportMarkdown: async () => "",
    async *send(_i, _id, body) {
      sent.push(body);
      messages.push({
        id: 1,
        seq: 1,
        role: "user",
        kind: body.kind,
        content:
          body.kind === "ask_agent"
            ? { quote: body.quote, question: body.question }
            : { text: body.text },
        created_at: "",
      });
      yield { type: "text_delta", text: reply };
      if (hold) await hold;
      yield { type: "done", duration_ms: 10 };
      messages.push({
        id: 2,
        seq: 2,
        role: "assistant",
        kind: "assistant",
        content: { answer: reply, blocks: [], duration_ms: 10, stopped: false },
        created_at: "",
      });
    },
    async *regenerate() {},
  };
  return { api, sent };
};

const fakeApi = () => {
  const rows: Highlight[] = [];
  const api: HighlightsApi = {
    list: async () => [...rows],
    add: vi.fn(async (_i, body) => {
      const row = { id: rows.length + 1, created_at: "now", ...body };
      rows.push(row);
      return row;
    }),
    remove: vi.fn(async () => {}),
  };
  return { api, rows };
};

const setup = (
  opts: {
    open?: () => Promise<PdfSource>;
    load?: () => Promise<ReaderItem>;
    chat?: ChatApi;
    hold?: Promise<void>;
  } = {},
) => {
  const { api, rows } = fakeApi();
  const chat = fakeChatApi("Streamed answer [p.3]", opts.hold);
  const open = opts.open ?? (async () => new FakeSource({ numPages: 5 }));
  const utils = render(
    <ReaderPage
      itemId="a1"
      load={opts.load ?? (async () => item())}
      open={open}
      api={api}
      chatApi={opts.chat ?? chat.api}
    />,
  );
  return { api, rows, open, chatSent: chat.sent, ...utils };
};

const select = async () => {
  Range.prototype.getClientRects = () =>
    [{ x: 160, y: 130, width: 100, height: 20 }] as unknown as DOMRectList;
  const span = await screen.findByText("Text of page 1");
  vi.spyOn(span.closest("[data-page]") as Element, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    width: 600,
    height: 800,
    left: 100,
    top: 100,
    right: 700,
    bottom: 900,
    toJSON: () => ({}),
  });
  const range = document.createRange();
  range.selectNodeContents(span);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(screen.getByTestId("pdf-scroll"));
};

test("shows the item and its PDF in two panes", async () => {
  setup();
  expect(await screen.findByRole("heading", { name: "Agents at scale" })).toBeTruthy();
  expect(screen.getByText("A bold hook.")).toBeTruthy();
  expect(await screen.findByText("Text of page 1")).toBeTruthy();
  expect(screen.getByRole("separator")).toBeTruthy();
});

test("says when there is no PDF", async () => {
  const open = vi.fn();
  setup({ load: async () => item({ has_pdf: false }), open });
  expect(await screen.findByText("No PDF for this item")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});

test("shows an error when loading the item fails", async () => {
  setup({
    load: async () => {
      throw new Error("404");
    },
  });
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("shows an error without an item id", async () => {
  render(<ReaderPage itemId="" load={async () => item()} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test.each([
  ["password", /password/i],
  ["invalid", /not a valid PDF/i],
  ["network", /could not be downloaded/i],
] as const)("a %s failure shows a clear message", async (reason, text) => {
  setup({
    open: async () => {
      throw new PdfOpenError(reason);
    },
  });
  expect((await screen.findByRole("alert")).textContent).toMatch(text);
});

test("a title with markup is rendered as text", async () => {
  setup({ load: async () => item({ title: "<script>x</script>" }) });
  expect(await screen.findByText("<script>x</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
});

test("asking from the selection box highlights in yellow, asks the agent and shows the streamed answer", async () => {
  const { api, chatSent } = setup();
  await select();
  const field = await screen.findByPlaceholderText("Ask about this passage…");
  await userEvent.type(field, "What does this mean?{Enter}");
  await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
  expect((api.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
    page: 1,
    color: "yellow",
    text: "Text of page 1",
  });
  await waitFor(() => expect(chatSent).toHaveLength(1));
  expect(chatSent[0]).toMatchObject({
    kind: "ask_agent",
    question: "What does this mean?",
    quote: { page: 1, text: "Text of page 1" },
  });
  expect(await screen.findByText(/Streamed answer/)).toBeTruthy();
  expect(screen.queryByPlaceholderText("Ask about this passage…")).toBeNull();
});

test("a page citation in the answer and the quote arrow move the PDF", async () => {
  setup();
  await select();
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "Where?{Enter}",
  );
  await userEvent.click(await screen.findByRole("button", { name: "p.3" }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("3"));
  await userEvent.click(screen.getByRole("button", { name: "Go to page 1" }));
  await waitFor(() => expect(field.value).toBe("1"));
});

test("a failing chat API shows an error line and the PDF stays usable", async () => {
  const broken: ChatApi = {
    ...fakeChatApi().api,
    listConversations: async () => {
      throw new Error("down");
    },
  };
  setup({ chat: broken });
  expect((await screen.findAllByRole("alert")).some((a) => /chat/i.test(a.textContent ?? ""))).toBe(
    true,
  );
  expect(await screen.findByText("Text of page 1")).toBeTruthy();
});

test("a colour dot highlights without asking and the highlight survives a remount", async () => {
  const { api, rows, unmount } = setup();
  await select();
  await userEvent.click(await screen.findByRole("button", { name: "Highlight green" }));
  await waitFor(() => expect(rows).toHaveLength(1));
  expect(rows[0]?.color).toBe("green");
  expect(await screen.findByRole("button", { name: "Highlights (1)" })).toBeTruthy();
  unmount();
  render(
    <ReaderPage
      itemId="a1"
      load={async () => item()}
      open={async () => new FakeSource({ numPages: 5 })}
      api={api}
      chatApi={fakeChatApi().api}
    />,
  );
  expect(await screen.findByRole("button", { name: "Highlights (1)" })).toBeTruthy();
});

test("Escape closes the selection box", async () => {
  setup();
  await select();
  await screen.findByPlaceholderText("Ask about this passage…");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByPlaceholderText("Ask about this passage…")).toBeNull();
});

test("Copy writes the quote to the clipboard", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  setup();
  await select();
  await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("Text of page 1");
});

test("the page in the URL is applied on load and kept up to date", async () => {
  window.location.hash = "#item=a1&page=3";
  setup();
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("3"));
  await userEvent.clear(field);
  await userEvent.type(field, "2{Enter}");
  await waitFor(() => expect(window.location.hash).toBe("#item=a1&page=2"));
});

test("a failed highlight save is reported to the user", async () => {
  const { api } = setup();
  (api.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("422"));
  await select();
  await userEvent.click(await screen.findByRole("button", { name: "Highlight red" }));
  expect((await screen.findByRole("status")).textContent).toMatch(/highlight/i);
});

test("a very long selection is trimmed so the highlight can be saved", async () => {
  const { api } = setup({
    open: async () => new FakeSource({ numPages: 5, text: () => "x".repeat(6000) }),
  });
  Range.prototype.getClientRects = () =>
    [{ x: 160, y: 130, width: 100, height: 20 }] as unknown as DOMRectList;
  const span = (await screen.findAllByText("x".repeat(6000)))[0] as HTMLElement;
  vi.spyOn(span.closest("[data-page]") as Element, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    width: 600,
    height: 800,
    left: 100,
    top: 100,
    right: 700,
    bottom: 900,
    toJSON: () => ({}),
  });
  const range = document.createRange();
  range.selectNodeContents(span);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(screen.getByTestId("pdf-scroll"));
  await userEvent.click(await screen.findByRole("button", { name: "Highlight red" }));
  await waitFor(() => expect(api.add).toHaveBeenCalled());
  const body = (api.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
  expect(body.text.length).toBeLessThanOrEqual(5000);
});

const selectPage = async (text: string) => {
  Range.prototype.getClientRects = () =>
    [{ x: 160, y: 130, width: 100, height: 20 }] as unknown as DOMRectList;
  const span = (await screen.findAllByText(text))[0] as HTMLElement;
  vi.spyOn(span.closest("[data-page]") as Element, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    width: 600,
    height: 800,
    left: 100,
    top: 100,
    right: 700,
    bottom: 900,
    toJSON: () => ({}),
  });
  const range = document.createRange();
  range.selectNodeContents(span);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(screen.getByTestId("pdf-scroll"));
};

test("asking about a very long selection sends a quote the server accepts", async () => {
  const { chatSent } = setup({
    open: async () => new FakeSource({ numPages: 5, text: () => "y".repeat(6000) }),
  });
  await selectPage("y".repeat(6000));
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "Why?{Enter}",
  );
  await waitFor(() => expect(chatSent).toHaveLength(1));
  const quote = (chatSent[0] as { quote: { text: string; rects: unknown[] } }).quote;
  expect(quote.text.length).toBeLessThanOrEqual(5000);
  expect(quote.rects.length).toBeLessThanOrEqual(200);
});

test("asking while an answer is streaming keeps the box and says to wait", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const { chatSent, api } = setup({ hold });
  await select();
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "First{Enter}",
  );
  await waitFor(() => expect(chatSent).toHaveLength(1));
  await selectPage("Text of page 1");
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "Second{Enter}",
  );
  expect(screen.getByPlaceholderText("Ask about this passage…")).toBeTruthy();
  expect(
    (await screen.findAllByRole("status")).some((s) => /wait/i.test(s.textContent ?? "")),
  ).toBe(true);
  expect(chatSent).toHaveLength(1);
  expect(api.add).toHaveBeenCalledTimes(1); // no highlight for a question that was not sent
  release();
});

test("a home link goes back to the catalogue with all the articles", async () => {
  setup();
  const home = await screen.findByRole("link", { name: "Back to the catalogue" });
  expect(home.getAttribute("href")).toBe("./");
  expect(home.getAttribute("rel")).toBeNull(); // same site: a normal link
});

test("the way home is also offered when the paper cannot be opened", async () => {
  setup({
    load: async () => {
      throw new Error("404");
    },
  });
  await screen.findByRole("alert");
  expect(screen.getByRole("link", { name: "Back to the catalogue" }).getAttribute("href")).toBe(
    "./",
  );
});

test("the way home is offered while loading and when the PDF fails", async () => {
  setup({
    open: async () => {
      throw new PdfOpenError("invalid");
    },
  });
  expect(screen.getByRole("link", { name: "Back to the catalogue" })).toBeTruthy();
  await screen.findByRole("alert");
  expect(screen.getByRole("link", { name: "Back to the catalogue" })).toBeTruthy();
});

test("the home control is the logo: no text, an accessible name and a tooltip", async () => {
  setup();
  const home = await screen.findByRole("link", { name: "Back to the catalogue" });
  expect(home.getAttribute("title")).toBe("Back to the catalogue");
  expect(home.querySelector("svg")).not.toBeNull();
  expect(home.textContent).toBe("Lw"); // the monogram only, no "Catalogue" label
});

test("the shortcuts gear is available in the reader", async () => {
  setup();
  expect(await screen.findByRole("button", { name: "Keyboard shortcuts" })).toBeTruthy();
});
