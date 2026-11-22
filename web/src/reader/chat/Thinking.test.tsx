import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Block } from "./reducer";
import { Thinking } from "./Thinking";

afterEach(cleanup);

const blocks: Block[] = [
  { type: "thinking", text: "I should look at page 2" },
  {
    type: "tool",
    id: "t",
    name: "load_artifact",
    input: { page_range: "1-2" },
    summary: "2 pages",
    is_error: false,
  },
];

const setup = (over: Partial<Parameters<typeof Thinking>[0]> = {}) => {
  const onToggle = vi.fn();
  render(
    <Thinking
      blocks={blocks}
      open={true}
      working={true}
      durationMs={null}
      onToggle={onToggle}
      {...over}
    />,
  );
  return onToggle;
};

test("says Thinking while working and shows the reasoning and the tool with its input", () => {
  setup();
  expect(screen.getByRole("button", { name: /Thinking/ })).toBeTruthy();
  expect(screen.getByText("I should look at page 2")).toBeTruthy();
  expect(screen.getByText("load_artifact")).toBeTruthy();
  expect(screen.getByText(/page_range/)).toBeTruthy();
  expect(screen.getByText(/2 pages/)).toBeTruthy();
});

test("says Thought for Ns afterwards", () => {
  setup({ working: false, durationMs: 4200, open: false });
  expect(screen.getByRole("button", { name: /Thought for 4s/ })).toBeTruthy();
  expect(screen.queryByText("I should look at page 2")).toBeNull();
});

test("a sub-second thought still reads as at least 1s", () => {
  setup({ working: false, durationMs: 200, open: false });
  expect(screen.getByRole("button", { name: /Thought for 1s/ })).toBeTruthy();
});

test("the header toggles and reports aria-expanded", async () => {
  const onToggle = setup({ open: false, working: false, durationMs: 1000 });
  const header = screen.getByRole("button", { name: /Thought for/ });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(header);
  expect(onToggle).toHaveBeenCalled();
});

test("is borderless and transparent: no boxed element", () => {
  const { container } = render(
    <Thinking blocks={blocks} open={true} working={false} durationMs={1000} onToggle={() => {}} />,
  );
  expect(container.querySelector(".thinking")).not.toBeNull();
  expect(container.querySelector("[class*='border'],[class*='card'],[class*='box']")).toBeNull();
  expect(container.querySelector("[style]")).toBeNull();
});

test("reasoning and tool inputs are shown as text, never as markup", () => {
  setup({
    blocks: [
      { type: "thinking", text: "<img src=x onerror=alert(1)>" },
      {
        type: "tool",
        id: "t",
        name: "<b>tool</b>",
        input: { q: "<script>" },
        summary: "<i>s</i>",
        is_error: false,
      },
    ],
  });
  expect(document.querySelector("img,b,i,script")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
});

test("renders nothing for an answer without any thinking", () => {
  const { container } = render(
    <Thinking blocks={[]} open={false} working={false} durationMs={100} onToggle={() => {}} />,
  );
  expect(container.textContent).toBe("");
});

test("while working with nothing yet, it still shows Thinking", () => {
  setup({ blocks: [] });
  expect(screen.getByRole("button", { name: /Thinking/ })).toBeTruthy();
});
