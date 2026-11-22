import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Citation } from "./events";
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

const verdict = (over: Partial<Citation>): Citation => ({
  page: 4,
  quote: "short exact quote",
  status: "verified",
  section: null,
  ...over,
});

const chip = (name: string) => screen.getByRole("button", { name });

test("a page with a quote becomes a chip showing only the page, and passes the quote on click", async () => {
  const onCite = show('As shown [p.4 "short exact quote"] here.');
  expect(document.body.textContent).not.toContain("short exact quote");
  await userEvent.click(chip("p.4"));
  expect(onCite).toHaveBeenCalledWith(4, "short exact quote");
});

test("the typographic quote forms and separators are understood", () => {
  show("[p.2: “a quote one”] [p.3, «a quote two»] [p.5 ]");
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["p.2", "p.3", "p.5"]);
});

test("the tooltip reads page, section and quote, omitting what is missing", () => {
  render(
    <Markdown
      text={'[p.4 "short exact quote"] [p.7]'}
      citations={[
        verdict({ section: "Method" }),
        verdict({ page: 7, quote: null, status: "page_only" }),
      ]}
    />,
  );
  expect(chip("p.4").getAttribute("title")).toBe("p.4 · Method · “short exact quote”");
  expect(chip("p.7").getAttribute("title")).toBe("p.7");
  expect(chip("p.4").className).not.toContain("cite-doubt");
});

test("without a verdict the chip is normal and the tooltip uses the written quote", () => {
  show('[p.4 "short exact quote"]');
  expect(chip("p.4").className).toBe("cite");
  expect(chip("p.4").getAttribute("title")).toBe("p.4 · “short exact quote”");
});

test("an unverified or invalid citation is doubtful and says the quote was not found", () => {
  render(
    <Markdown
      text={'[p.4 "short exact quote"] [p.99 "elsewhere in space"]'}
      citations={[
        verdict({ status: "unverified" }),
        verdict({ page: 99, quote: "elsewhere in space", status: "invalid_page" }),
      ]}
    />,
  );
  for (const name of ["p.4", "p.99"]) {
    expect(chip(name).className).toContain("cite-doubt");
    expect(chip(name).getAttribute("title")).toMatch(/not found/i);
  }
});

test("a wrong page is doubtful, says where it was found, and goes there", async () => {
  const onCite = vi.fn();
  render(
    <Markdown
      text={'[p.4 "short exact quote"]'}
      citations={[verdict({ status: "wrong_page", found_page: 9 })]}
      onCite={onCite}
    />,
  );
  expect(chip("p.4").className).toContain("cite-doubt");
  expect(chip("p.4").getAttribute("title")).toContain("p.9 instead");
  await userEvent.click(chip("p.4"));
  expect(onCite).toHaveBeenCalledWith(9, "short exact quote");
});

test("a verdict is matched by page and normalised quote", () => {
  render(
    <Markdown
      text={'[p.4 "Short,  EXACT quote"] [p.5 "short exact quote"]'}
      citations={[verdict({ status: "unverified" })]}
    />,
  );
  expect(chip("p.4").className).toContain("cite-doubt");
  expect(chip("p.5").className).toBe("cite");
});

test("a hostile quote is never rendered as HTML", () => {
  render(
    <Markdown
      text={'[p.4 "</b><img src=x onerror=alert(1)>"]'}
      citations={[verdict({ quote: "</b><img src=x onerror=alert(1)>", section: "<i>S</i>" })]}
    />,
  );
  expect(document.querySelector("img,b,i")).toBeNull();
  expect(chip("p.4").getAttribute("title")).toContain("</b>");
});
