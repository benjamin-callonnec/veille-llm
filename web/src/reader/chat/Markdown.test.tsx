import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Markdown } from "./Markdown";

afterEach(cleanup);

const show = (text: string, onCite = vi.fn()) => {
  render(<Markdown text={text} onCite={onCite} />);
  return onCite;
};

test("raw HTML and scripts are shown as text", () => {
  show("Hello <script>alert(1)</script> <b>bold</b>");
  expect(document.querySelector("script,b")).toBeNull();
  expect(document.body.textContent).toContain("<script>");
});

test("javascript links are not links; https links keep rel", () => {
  show("[bad](javascript:alert(1)) and [good](https://example.org/x)");
  const links = Array.from(document.querySelectorAll("a"));
  expect(links).toHaveLength(1);
  expect(links[0]?.getAttribute("href")).toBe("https://example.org/x");
  expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(document.body.textContent).toContain("bad");
});

test("data and other schemes are not links", () => {
  show("[x](data:text/html,<p>) [y](vbscript:z) [z](file:///etc/passwd)");
  expect(document.querySelectorAll("a")).toHaveLength(0);
});

test("remote images are never loaded", () => {
  show("![alt text](https://tracker.example/pixel.png)");
  expect(document.querySelector("img")).toBeNull();
  expect(document.body.textContent).toContain("alt text");
});

test("a page reference becomes a citation button", async () => {
  const onCite = show("See [p.4] and also [p.12].");
  await userEvent.click(screen.getByRole("button", { name: "p.4" }));
  expect(onCite).toHaveBeenCalledWith(4);
  expect(screen.getByRole("button", { name: "p.12" })).toBeTruthy();
});

test("math renders and broken math does not crash", () => {
  show("Inline $E = mc^2$ and block:\n\n$$\\frac{a}{b}$$\n\nand broken $\\frac{a$ here");
  expect(document.querySelectorAll(".katex").length).toBeGreaterThan(0);
});

test("GFM tables and code blocks render, and code can be copied", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  show("| a | b |\n|---|---|\n| 1 | 2 |\n\n```py\nprint('hi')\n```");
  expect(document.querySelector("table")).not.toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
  expect(writeText).toHaveBeenCalledWith("print('hi')");
  vi.unstubAllGlobals();
});

test("a very long answer renders", () => {
  show("word ".repeat(20000));
  expect(document.body.textContent?.length).toBeGreaterThan(90000);
});
