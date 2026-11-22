import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Item } from "../lib/catalogue";
import { App } from "./App";

const item = (over: Partial<Item>): Item => ({
  id: "a",
  source: "arxiv",
  kind: "paper",
  title: "Agents at scale",
  url: "https://example.com/a",
  authors: [],
  published: "2026-11-20T00:00:00Z",
  upvotes: 3,
  score: 7,
  type: "paper",
  category: "Agents",
  hook: "A bold hook.",
  brief: "A brief explanation.",
  ...over,
});

const payload = (items: Item[]) => ({
  generated_at: "2026-11-22T06:00:00Z",
  window_days: 30,
  categories: [],
  items,
});

const loader = (items: Item[]) => async () => payload(items);

beforeEach(() => {
  window.location.hash = "";
});
afterEach(cleanup);

test("shows the hook in bold, then the brief, and never a raw abstract", async () => {
  render(<App load={loader([item({})])} />);
  const hook = await screen.findByText("A bold hook.");
  expect(hook.tagName).toBe("STRONG");
  expect(screen.getByText("A brief explanation.")).toBeTruthy();
});

test("the title links out only for http(s) urls", async () => {
  render(
    <App
      load={loader([
        item({ id: "1", title: "Safe", url: "https://example.com/x" }),
        item({ id: "2", title: "Evil", url: "javascript:alert(1)" }),
      ])}
    />,
  );
  expect((await screen.findByRole("link", { name: "Safe" })).getAttribute("href")).toBe(
    "https://example.com/x",
  );
  expect(screen.queryByRole("link", { name: "Evil" })).toBeNull();
  expect(screen.getByText("Evil")).toBeTruthy();
});

test("markup in text fields is shown as text, not interpreted", async () => {
  render(<App load={loader([item({ hook: "<img src=x onerror=alert(1)>" })])} />);
  await screen.findByText("<img src=x onerror=alert(1)>");
  expect(document.querySelector("img")).toBeNull();
});

test("clicking a category chip filters the list and records it in the url", async () => {
  const user = userEvent.setup();
  render(
    <App
      load={loader([
        item({ id: "1", title: "About agents", category: "Agents" }),
        item({ id: "2", title: "About security", category: "Security" }),
      ])}
    />,
  );
  await screen.findByText("About agents");
  const chip = screen.getByRole("button", { name: /^Security/ });
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  await user.click(chip);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByText("About agents")).toBeNull();
  expect(screen.getByText("About security")).toBeTruthy();
  expect(window.location.hash).toContain("cat=Security");
});

test("the url hash restores filters on load and ignores unknown categories", async () => {
  window.location.hash = "#cat=Security,Gone";
  render(
    <App
      load={loader([
        item({ id: "1", title: "About agents", category: "Agents" }),
        item({ id: "2", title: "About security", category: "Security" }),
      ])}
    />,
  );
  await screen.findByText("About security");
  expect(screen.queryByText("About agents")).toBeNull();
});

test("type filter and search narrow the list; an empty result says so", async () => {
  const user = userEvent.setup();
  render(
    <App
      load={loader([
        item({ id: "1", title: "A paper", type: "paper" }),
        item({ id: "2", title: "A post", type: "news" }),
      ])}
    />,
  );
  await screen.findByText("A paper");
  await user.click(screen.getByRole("button", { name: "News" }));
  expect(screen.queryByText("A paper")).toBeNull();
  await user.type(screen.getByRole("searchbox"), "zzz");
  expect(screen.getByText(/No items match/)).toBeTruthy();
});

test("categories beyond the chip limit are reachable from the +N menu", async () => {
  const items = Array.from({ length: 10 }, (_, n) =>
    item({ id: String(n), title: `T${n}`, category: `Cat${n}` }),
  );
  render(<App load={loader(items)} />);
  await screen.findByText("T0");
  const more = screen.getByRole("group", { name: "More categories" });
  expect(within(more).getAllByRole("button").length).toBe(3);
});

test("shows a loading state, then an error state when the catalogue fails", async () => {
  render(
    <App
      load={async () => {
        throw new Error("boom");
      }}
    />,
  );
  expect(screen.getByText(/Loading/)).toBeTruthy();
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("categories that no longer exist are dropped from the url once loaded", async () => {
  window.location.hash = "#cat=Security,Gone";
  render(<App load={loader([item({ id: "2", title: "About security", category: "Security" })])} />);
  await screen.findByText("About security");
  await waitFor(() => expect(window.location.hash).toBe("#cat=Security"));
});

test("editing the hash (back/forward) updates the filters", async () => {
  render(
    <App
      load={loader([
        item({ id: "1", title: "About agents", category: "Agents" }),
        item({ id: "2", title: "About security", category: "Security" }),
      ])}
    />,
  );
  await screen.findByText("About agents");
  act(() => {
    window.location.hash = "#cat=Security";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(screen.queryByText("About agents")).toBeNull();
});

test("the sort select reorders the list and is kept in the url", async () => {
  const user = userEvent.setup();
  render(
    <App
      load={loader([
        item({ id: "1", title: "Low score", score: 2, upvotes: 90 }),
        item({ id: "2", title: "High score", score: 9, upvotes: 1 }),
      ])}
    />,
  );
  await screen.findByText("Low score");
  await user.selectOptions(screen.getByRole("combobox"), "score");
  const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(titles).toEqual(["High score", "Low score"]);
  expect(window.location.hash).toContain("sort=score");
});

test("a slow older response never overwrites a newer catalogue", async () => {
  let release: (v: unknown) => void = () => {};
  const slow = () => new Promise((resolve) => (release = resolve));
  const { rerender } = render(<App load={slow} />);
  rerender(<App load={loader([item({ id: "n", title: "Newer" })])} />);
  await screen.findByText("Newer");
  await act(async () => release(payload([item({ id: "o", title: "Older" })])));
  expect(screen.queryByText("Older")).toBeNull();
  expect(screen.getByText("Newer")).toBeTruthy();
});

test("/ focuses the search box", async () => {
  render(<App load={loader([item({})])} />);
  await screen.findByRole("heading", { name: "LLM watch" });
  expect(screen.queryByRole("link", { name: "Home" })).toBeNull(); // the shell provides it
  await userEvent.keyboard("/");
  expect(document.activeElement).toBe(screen.getByRole("searchbox"));
});

test("the catalogue header is the shared page head, next to the logo", async () => {
  render(<App load={loader([item({})])} />);
  const heading = await screen.findByRole("heading", { name: "LLM watch" });
  expect(heading.closest("header")?.className).toContain("page-head");
});
