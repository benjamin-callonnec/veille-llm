import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { CSP } from "./csp";
import { HtmlFrame } from "./HtmlFrame";

afterEach(cleanup);

test("the frame is sandboxed with scripts only: never the same origin", () => {
  render(<HtmlFrame content="<p>hi</p>" title="Deck" />);
  const frame = screen.getByTitle("Deck");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("srcdoc")).toContain(CSP);
  expect(frame.getAttribute("srcdoc")).toContain("<p>hi</p>");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
});
