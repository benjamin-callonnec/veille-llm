import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CSP, KEY_BRIDGE } from "./csp";
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

test("the page gets the keyboard focus once loaded, so the arrow keys work at once", () => {
  render(<HtmlFrame content="<p>hi</p>" title="Deck" />);
  const frame = screen.getByTitle("Deck") as HTMLIFrameElement;
  const focus = vi.spyOn(frame, "focus");
  fireEvent.load(frame);
  expect(focus).toHaveBeenCalledTimes(1);
});

const tell = (source: Window | null, data: unknown) =>
  fireEvent(window, new MessageEvent("message", { data, source }));

test("the page carries the key bridge, and V or Escape typed inside reach the parent", () => {
  const onKey = vi.fn();
  render(<HtmlFrame content="<p>hi</p>" title="Deck" onKey={onKey} />);
  const frame = screen.getByTitle("Deck") as HTMLIFrameElement;
  expect(frame.getAttribute("srcdoc")).toContain(KEY_BRIDGE);
  tell(frame.contentWindow, { veilleKey: "v" });
  tell(frame.contentWindow, { veilleKey: "Escape" });
  expect(onKey.mock.calls).toEqual([["v"], ["Escape"]]);
});

test("messages from elsewhere or with another shape are ignored", () => {
  const onKey = vi.fn();
  render(<HtmlFrame content="<p>hi</p>" title="Deck" onKey={onKey} />);
  const frame = screen.getByTitle("Deck") as HTMLIFrameElement;
  tell(window, { veilleKey: "v" }); // not from the frame
  tell(frame.contentWindow, { veilleKey: "x" });
  tell(frame.contentWindow, { veilleKey: 3 });
  tell(frame.contentWindow, "v");
  tell(frame.contentWindow, null);
  expect(onKey).not.toHaveBeenCalled();
});
