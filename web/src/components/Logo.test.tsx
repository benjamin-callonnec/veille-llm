import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Logo } from "./Logo";

afterEach(cleanup);

test("the logo is a decorative monogram with the letters Lw", () => {
  const { container } = render(<Logo size={28} />);
  const svg = container.querySelector("svg");
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
  expect(svg?.getAttribute("width")).toBe("28");
  expect(container.textContent).toBe("Lw");
  expect(container.querySelector("rect")?.getAttribute("rx")).toBe("8");
});

test("it takes its colours from the theme tokens, not from fixed values", () => {
  const { container } = render(<Logo />);
  expect(container.querySelector("rect")?.getAttribute("fill")).toBe("var(--accent)");
  expect(container.querySelector("text")?.getAttribute("fill")).toBe("var(--accent-fg)");
});
