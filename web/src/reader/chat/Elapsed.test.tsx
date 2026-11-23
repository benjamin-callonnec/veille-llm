import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Elapsed } from "./Elapsed";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const text = () => screen.getByLabelText("Elapsed time").textContent;

test("it counts up every second while the answer is being produced", () => {
  render(<Elapsed startedAt={Date.now()} durationMs={null} running />);
  expect(text()).toBe("0:00");
  act(() => {
    vi.advanceTimersByTime(7000);
  });
  expect(text()).toBe("0:07");
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(text()).toBe("1:07");
});

test("it starts from the time the question was sent, not from the first render", () => {
  render(<Elapsed startedAt={Date.now() - 12_000} durationMs={null} running />);
  expect(text()).toBe("0:12");
});

test("once finished it shows the final duration and stops ticking", () => {
  const { rerender } = render(<Elapsed startedAt={Date.now()} durationMs={null} running />);
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  rerender(<Elapsed startedAt={Date.now() - 3000} durationMs={4200} running={false} />);
  expect(text()).toBe("0:04");
  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(text()).toBe("0:04");
});

test("a stored answer shows its duration and starts no timer", () => {
  render(<Elapsed durationMs={65_000} running={false} />);
  expect(text()).toBe("1:05");
  expect(vi.getTimerCount()).toBe(0);
});

test("nothing is shown when there is neither a start nor a duration", () => {
  const { container } = render(<Elapsed durationMs={null} running={false} />);
  expect(container.textContent).toBe("");
});

test("the timer is cleared when the message goes away", () => {
  const { unmount } = render(<Elapsed startedAt={Date.now()} durationMs={null} running />);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
