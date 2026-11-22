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

test("papers get a Read link when the reader is configured", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({})} />);
  const link = screen.getByRole("link", { name: "Read" });
  expect(link.getAttribute("href")).toBe("http://127.0.0.1:8765/reader.html#item=a1");
});

test("no Read link without the reader configured", () => {
  vi.stubEnv("VITE_READER_URL", "");
  render(<Card item={item({})} />);
  expect(screen.queryByRole("link", { name: "Read" })).toBeNull();
});

test("no Read link for news", () => {
  vi.stubEnv("VITE_READER_URL", "http://127.0.0.1:8765");
  render(<Card item={item({ type: "news" })} />);
  expect(screen.queryByRole("link", { name: "Read" })).toBeNull();
});
