import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Icon, IconButton, type IconName } from "./Icon";

afterEach(cleanup);

const NAMES: IconName[] = [
  "send",
  "stop",
  "plus",
  "copy",
  "check",
  "retry",
  "more",
  "edit",
  "download",
  "trash",
  "chevron",
  "compose",
  "search",
  "outline",
  "settings",
];

test.each(NAMES)("the %s icon is a decorative svg drawn in the current colour", (name) => {
  const { container } = render(<Icon name={name} />);
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
  expect(svg?.getAttribute("focusable")).toBe("false");
  expect(svg?.innerHTML).not.toBe("");
  expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i); // no fixed colour
});

test("the size is configurable", () => {
  const { container } = render(<Icon name="copy" size={20} />);
  expect(container.querySelector("svg")?.getAttribute("width")).toBe("20");
});

test("an icon button has an accessible name and the same tooltip", async () => {
  const onClick = vi.fn();
  render(<IconButton icon="copy" label="Copy" onClick={onClick} />);
  const button = screen.getByRole("button", { name: "Copy" });
  expect(button.getAttribute("title")).toBe("Copy");
  expect(button.textContent).toBe("");
  await userEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("a disabled icon button does nothing", async () => {
  const onClick = vi.fn();
  render(<IconButton icon="send" label="Send" onClick={onClick} disabled />);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(onClick).not.toHaveBeenCalled();
});

test("the extra class is kept", () => {
  render(<IconButton icon="more" label="More" onClick={() => {}} className="quiet" />);
  expect(screen.getByRole("button", { name: "More" }).className).toContain("quiet");
});
