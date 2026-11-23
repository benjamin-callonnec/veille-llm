import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Item } from "../lib/catalogue";
import { Card } from "./Card";

const item = (over: Partial<Item>): Item => ({
  id: "a1",
  source: "arxiv",
  kind: "paper",
  title: "Agents at scale",
  url: "https://arxiv.org/abs/2401.01234",
  authors: [],
  published: "2026-11-20T00:00:00Z",
  upvotes: 0,
  github_stars: 0,
  score: 7,
  type: "paper",
  category: "Agents",
  hook: "A bold hook.",
  brief: "",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const openLink = () => screen.getByRole("link", { name: /in the reader/ });

test("a paper card opens the reader when clicked, through one link that covers the card", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({})} />);
  const link = openLink();
  expect(link.getAttribute("href")).toBe("reader.html#item=a1");
  expect(link.getAttribute("aria-label")).toBe('Open "Agents at scale" in the reader');
  expect(link.className).toContain("card-open");
  expect(link.closest("article")).not.toBeNull();
});

test("there is no visible Read link any more", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({})} />);
  expect(screen.queryByText("Read")).toBeNull();
  expect(screen.queryByRole("link", { name: "Read" })).toBeNull();
  expect(openLink().textContent).toBe("");
});

test("the title still opens the original article in a new tab", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({})} />);
  const title = screen.getByRole("link", { name: "Agents at scale" });
  expect(title.getAttribute("href")).toBe("https://arxiv.org/abs/2401.01234");
  expect(title.getAttribute("target")).toBe("_blank");
  expect(title.getAttribute("rel")).toBe("noopener noreferrer");
});

test("without the reader enabled the card is not clickable", () => {
  vi.stubEnv("VITE_READER_URL", "");
  render(<Card item={item({})} />);
  expect(screen.queryByRole("link", { name: /in the reader/ })).toBeNull();
});

test("any item with an arXiv PDF is clickable, whatever its type (benchmarks too)", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({ type: "benchmark" })} />);
  expect(openLink().getAttribute("href")).toBe("reader.html#item=a1");
});

test("an item without an arXiv PDF is not clickable, even a paper", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  for (const url of [
    "https://example.com/a",
    "https://huggingface.co/papers/2401.01234",
    "https://arxiv.org.evil.com/abs/2401.01234",
  ]) {
    render(<Card item={item({ url, type: "paper" })} />);
    expect(screen.queryByRole("link", { name: /in the reader/ })).toBeNull();
    cleanup();
  }
});

test("the link does not depend on the port set at build time", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8798");
  render(<Card item={item({})} />);
  expect(openLink().getAttribute("href")).toBe("reader.html#item=a1");
});

test("a title with markup is only ever text in the accessible name", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({ title: "<b>x</b>" })} />);
  expect(document.querySelector("b")).toBeNull();
  expect(openLink().getAttribute("aria-label")).toBe('Open "<b>x</b>" in the reader');
});

test("the card shows the GitHub stars of the linked repo, and nothing when there is none", () => {
  render(<Card item={item({ github_stars: 162 })} />);
  expect(screen.getByText("162 GitHub stars")).toBeTruthy();
  cleanup();
  render(<Card item={item({ github_stars: 0 })} />);
  expect(screen.queryByText(/GitHub stars/)).toBeNull();
});
