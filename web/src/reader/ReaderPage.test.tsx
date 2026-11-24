import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FavoritesApi } from "../hooks/useFavorites";
import type { ChatApi, StoredMessage } from "./chat/api";
import { FakeSource } from "./pdf/fakeSource";
import { PdfOpenError, type PdfSource } from "./pdf/source";
import { type ReaderItem, ReaderPage } from "./ReaderPage";
import type { Caption } from "./structureApi";
import type { Highlight, HighlightsApi } from "./useHighlights";
import type { ReportMeta } from "./viewer/reportsApi";

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

const fakeFavorites = (ids: string[] = []) => {
  const state = { ids: [...ids] };
  const api: FavoritesApi = {
    list: async () => state.ids.map((id) => ({ item_id: id, item: null, added_at: "x" })),
    add: async (id) => {
      state.ids = [id, ...state.ids];
    },
    remove: async (id) => {
      state.ids = state.ids.filter((i) => i !== id);
    },
  };
  return Object.assign(api, { state });
};

const setup = (
  opts: {
    open?: () => Promise<PdfSource>;
    load?: () => Promise<ReaderItem>;
    chat?: ChatApi;
    hold?: Promise<void>;
    reply?: string;
    highlights?: Highlight[];
    captions?: Caption[];
    captionsApi?: (item: string) => Promise<Caption[]>;
    reports?: () => Promise<ReportMeta[]>;
    favorites?: FavoritesApi;
  } = {},
) => {
  const { api, rows } = fakeApi();
  rows.push(...(opts.highlights ?? []));
  const chat = fakeChatApi(opts.reply ?? "Streamed answer [p.3]", opts.hold);
  const open = opts.open ?? (async () => new FakeSource({ numPages: 5 }));
  const utils = render(
    <ReaderPage
      itemId="a1"
      load={opts.load ?? (async () => item())}
      open={open}
      api={api}
      chatApi={opts.chat ?? chat.api}
      captionsApi={opts.captionsApi ?? (async () => opts.captions ?? [])}
      reportsApi={opts.reports ?? (async () => [])}
      favoritesApi={opts.favorites ?? fakeFavorites()}
    />,
  );
  return { api, rows, open, chatSent: chat.sent, ...utils };
};

// The page in the viewer has the keyboard focus: V and Escape typed in it reach the app through
// its key bridge (a message), never as a key event of the app's window.
const fromFrame = (key: string) =>
  fireEvent(
    window,
    new MessageEvent("message", {
      data: { veilleKey: key },
      source: (screen.getByTitle("Deck") as HTMLIFrameElement).contentWindow,
    }),
  );

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

test("clicking a citation with a quote goes to the page and flashes the quote", async () => {
  setup({ reply: 'It says [p.3 "Text of page 3"]' });
  await select();
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "Where?{Enter}",
  );
  expect(document.querySelector("[data-flash]")).toBeNull();
  await userEvent.click(await screen.findByRole("button", { name: "p.3" }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("3"));
  await waitFor(() =>
    expect(document.querySelector('[data-page="3"] [data-flash]')).not.toBeNull(),
  );
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

test("the page leaves the logo and the settings gear to the shared shell", async () => {
  setup();
  await screen.findByRole("heading", { name: "Agents at scale" });
  expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
});

test("the reader header is the shared page head, in every state", async () => {
  const ok = setup();
  const heading = await screen.findByRole("heading", { name: "Agents at scale" });
  expect(heading.closest("header")?.className).toContain("page-head");
  ok.unmount();
  setup({
    load: async () => {
      throw new Error("404");
    },
  });
  await screen.findByRole("alert");
  expect(document.querySelector("header")?.className).toContain("page-head");
});

test("the model that answers is shown quietly under the composer", async () => {
  const { api } = fakeApi();
  render(
    <ReaderPage
      itemId="a1"
      load={async () => item()}
      open={async () => new FakeSource({ numPages: 5 })}
      api={api}
      chatApi={fakeChatApi().api}
      health={async () => ({ model: "claude-sonnet-5-5" })}
    />,
  );
  expect(await screen.findByText("Sonnet 5.5")).toBeTruthy();
});

test("a failing health check just leaves the model out", async () => {
  const { api } = fakeApi();
  render(
    <ReaderPage
      itemId="a1"
      load={async () => item()}
      open={async () => new FakeSource({ numPages: 5 })}
      api={api}
      chatApi={fakeChatApi().api}
      health={async () => {
        throw new Error("down");
      }}
    />,
  );
  expect(await screen.findByRole("textbox", { name: "Message" })).toBeTruthy();
  expect(document.querySelector(".composer-status")).toBeNull();
});

test("a highlight row goes back to its stored place and flashes it", async () => {
  setup({
    highlights: [
      {
        id: 7,
        page: 3,
        color: "yellow",
        text: "placed",
        rects: [[0.1, 0.5, 0.3, 0.02]],
        created_at: "now",
      },
    ],
  });
  await userEvent.click(await screen.findByRole("button", { name: "Highlights (1)" }));
  expect(document.querySelector("[data-flash]")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /p\.3/ }));
  await waitFor(() =>
    expect(document.querySelector('[data-page="3"] [data-flash]')).not.toBeNull(),
  );
});

test("a highlight without stored rects goes to its page without error", async () => {
  setup({
    highlights: [{ id: 8, page: 2, color: "green", text: "old", rects: [], created_at: "now" }],
  });
  await userEvent.click(await screen.findByRole("button", { name: "Highlights (1)" }));
  await userEvent.click(screen.getByRole("button", { name: /p\.2/ }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("2"));
  expect(document.querySelector("[data-flash]")).toBeNull();
});

test("the quote of an ask-the-agent question flashes its place in the PDF", async () => {
  setup();
  await select();
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "Where?{Enter}",
  );
  await userEvent.click(await screen.findByRole("button", { name: "Go to page 1" }));
  await waitFor(() =>
    expect(document.querySelector('[data-page="1"] [data-flash]')).not.toBeNull(),
  );
});

const ask = async () => {
  await select();
  await userEvent.type(
    await screen.findByPlaceholderText("Ask about this passage…"),
    "Where?{Enter}",
  );
};

test("a cited figure is shown in place, on the page of its caption", async () => {
  setup({
    reply: "As shown in [p.2 Figure 1]",
    captions: [{ kind: "figure", number: "1", page: 3, rect: [0.1, 0.5, 0.3, 0.02] }],
  });
  await ask();
  await userEvent.click(await screen.findByRole("button", { name: "p.2" }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("3"));
  await waitFor(() =>
    expect(document.querySelector('[data-page="3"] [data-flash]')).not.toBeNull(),
  );
});

test("a cited figure the structure does not know stays on the cited page without error", async () => {
  setup({ reply: "As shown in [p.2 Figure 9]", captions: [] });
  await ask();
  await userEvent.click(await screen.findByRole("button", { name: "p.2" }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("2"));
  await new Promise((r) => setTimeout(r, 50));
  expect(document.querySelector("[data-flash]")).toBeNull();
});

test("a figure found late does not override a later click", async () => {
  let release: (c: Caption[]) => void = () => {};
  const late = new Promise<Caption[]>((r) => {
    release = r;
  });
  setup({ reply: "See [p.2 Figure 1] and [p.4]", captionsApi: () => late });
  await ask();
  await userEvent.click(await screen.findByRole("button", { name: "p.2" }));
  await userEvent.click(screen.getByRole("button", { name: "p.4" }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("4"));
  release([{ kind: "figure", number: "1", page: 3, rect: [0.1, 0.5, 0.3, 0.02] }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(field.value).toBe("4");
  expect(document.querySelector("[data-flash]")).toBeNull();
});

test("a figure found late does not override the page typed meanwhile", async () => {
  let release: (c: Caption[]) => void = () => {};
  const late = new Promise<Caption[]>((r) => {
    release = r;
  });
  setup({ reply: "See [p.2 Figure 1]", captionsApi: () => late });
  await ask();
  await userEvent.click(await screen.findByRole("button", { name: "p.2" }));
  const field = (await screen.findByRole("spinbutton", { name: "Page" })) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("2"));
  await userEvent.clear(field);
  await userEvent.type(field, "5{Enter}");
  await waitFor(() => expect(field.value).toBe("5"));
  release([{ kind: "figure", number: "1", page: 3, rect: [0.1, 0.5, 0.3, 0.02] }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(field.value).toBe("5");
});

test("V opens the viewer and V closes it", async () => {
  setup();
  await screen.findByText("Text of page 1");
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
  await userEvent.keyboard("v");
  expect(screen.getByRole("region", { name: "Viewer" })).toBeTruthy();
  await userEvent.keyboard("v");
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
});

test("V does nothing while typing or with a modifier", async () => {
  setup();
  await screen.findByText("Text of page 1");
  const box = await screen.findByRole("textbox");
  await userEvent.type(box, "v");
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
  box.blur();
  await userEvent.keyboard("{Meta>}v{/Meta}");
  await userEvent.keyboard("{Control>}v{/Control}");
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
});

test("the viewer opens by itself when the tutor saved a report", async () => {
  const meta: ReportMeta = { id: 7, title: "Deck", version: 1, updated_at: "" };
  let saved = false;
  const reports = vi.fn(async () => (saved ? [meta] : []));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 7, title: "Deck", version: 1, versions: [], html: "<p>x</p>" }),
    })),
  );
  const { api } = fakeChatApi();
  const chat: ChatApi = {
    ...api,
    async *send(...args) {
      saved = true;
      yield { type: "tool_use", id: "t", name: "write_report", input: {} };
      yield { type: "tool_result", id: "t", summary: "Saved", is_error: false };
      yield* api.send(...args);
    },
  };
  setup({ chat, reports });
  await screen.findByText("Text of page 1");
  await userEvent.type(await screen.findByRole("textbox"), "go{Enter}");
  expect(await screen.findByRole("region", { name: "Viewer" })).toBeTruthy();
  expect(await screen.findByText("Deck")).toBeTruthy();
});

test("a closed viewer comes back with the reports icon of the chat", async () => {
  const meta: ReportMeta = { id: 7, title: "Deck", version: 1, updated_at: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 7, title: "Deck", version: 1, versions: [], html: "<p>x</p>" }),
    })),
  );
  setup({ reports: async () => [meta] });
  await screen.findByText("Text of page 1");
  const icon = await screen.findByRole("button", { name: "Reports (V)" });
  await userEvent.click(icon);
  expect(screen.getByRole("region", { name: "Viewer" })).toBeTruthy();
  await screen.findByTitle("Deck");
  fromFrame("Escape");
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Reports (V)" }));
  expect(screen.getByRole("region", { name: "Viewer" })).toBeTruthy();
});

test("with no report there is no reports icon", async () => {
  setup();
  await screen.findByText("Text of page 1");
  expect(screen.queryByRole("button", { name: "Reports (V)" })).toBeNull();
});

test("closing the viewer with V and opening it again keeps the page where it was", async () => {
  const meta: ReportMeta = { id: 7, title: "Deck", version: 1, updated_at: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 7, title: "Deck", version: 1, versions: [], html: "<p>x</p>" }),
    })),
  );
  setup({ reports: async () => [meta] });
  await screen.findByText("Text of page 1");
  await userEvent.keyboard("v");
  const frame = await screen.findByTitle("Deck");
  fromFrame("v");
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "v" }); // a hidden frame gives the focus back to the page
  expect(await screen.findByTitle("Deck")).toBe(frame); // the same frame, not a new one
});

test("a citation of the report previews the paper, and Open in the PDF goes there", async () => {
  const meta: ReportMeta = { id: 7, title: "Deck", version: 1, updated_at: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 7, title: "Deck", version: 1, versions: [], html: "<p>x</p>" }),
    })),
  );
  setup({ reports: async () => [meta] });
  await screen.findByText("Text of page 1");
  await userEvent.keyboard("v");
  await screen.findByTitle("Deck");
  fireEvent(
    window,
    new MessageEvent("message", {
      data: { veilleCite: { page: 3, quote: "Text of page 3" } },
      source: (screen.getByTitle("Deck") as HTMLIFrameElement).contentWindow,
    }),
  );
  expect(screen.getByLabelText("Preview of the paper")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open in the PDF" }));
  expect(screen.queryByRole("region", { name: "Viewer" })).toBeNull();
  await waitFor(() => expect((screen.getByLabelText("Page") as HTMLInputElement).value).toBe("3"));
});

test("a figure citation still works after the captions failed once", async () => {
  const meta: ReportMeta = { id: 7, title: "Deck", version: 1, updated_at: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 7, title: "Deck", version: 1, versions: [], html: "<p>x</p>" }),
    })),
  );
  const captionsApi = vi
    .fn<(item: string) => Promise<Caption[]>>()
    .mockRejectedValueOnce(new Error("hiccup"))
    .mockResolvedValue([{ kind: "figure", number: "3", page: 2, rect: [0.1, 0.4, 0.5, 0.03] }]);
  setup({ reports: async () => [meta], captionsApi });
  await screen.findByText("Text of page 1");
  await userEvent.keyboard("v");
  await screen.findByTitle("Deck");
  const cite = (number: string) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { veilleCite: { page: 2, kind: "figure", number } },
        source: (screen.getByTitle("Deck") as HTMLIFrameElement).contentWindow,
      }),
    );
  cite("2"); // the captions fail: the card says it could not be drawn
  await screen.findByText("The preview could not be drawn");
  cite("3"); // asked again, not stuck on the failure
  await waitFor(() => expect(captionsApi).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("The preview could not be drawn")).toBeNull());
});

test("the star in the header adds the paper to the favorites and removes it", async () => {
  const favorites = fakeFavorites();
  setup({ favorites });
  await userEvent.click(await screen.findByRole("button", { name: "Add to favorites" }));
  expect(await screen.findByRole("button", { name: "Remove from favorites" })).toBeTruthy();
  expect(favorites.state.ids).toEqual(["a1"]);
  await userEvent.click(screen.getByRole("button", { name: "Remove from favorites" }));
  await waitFor(() => expect(favorites.state.ids).toEqual([]));
});

test("S toggles the favorite, never while typing", async () => {
  const favorites = fakeFavorites(["a1"]);
  setup({ favorites });
  await screen.findByRole("button", { name: "Remove from favorites" });
  const box = await screen.findByRole("textbox");
  await userEvent.type(box, "s");
  expect(favorites.state.ids).toEqual(["a1"]);
  box.blur();
  await userEvent.keyboard("s");
  await waitFor(() => expect(favorites.state.ids).toEqual([]));
});
