import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { OutlineMenu } from "./OutlineMenu";
import { FakeSource } from "./pdf/fakeSource";
import { SearchBar } from "./SearchBar";

afterEach(cleanup);

const source = (extra = {}) =>
  new FakeSource({
    numPages: 20,
    text: (p) => (p % 5 === 0 ? `page ${p} has the needle here` : `page ${p}`),
    ...extra,
  });

test("finds hits across pages, jumps to the first and moves with Enter", async () => {
  const onGo = vi.fn();
  render(<SearchBar source={source()} onGo={onGo} onQuery={() => {}} onClose={() => {}} />);
  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "needle");
  await waitFor(() => expect(screen.getByText("1 of 4")).toBeTruthy());
  expect(onGo).toHaveBeenLastCalledWith(5);
  await userEvent.keyboard("{Enter}");
  expect(screen.getByText("2 of 4")).toBeTruthy();
  expect(onGo).toHaveBeenLastCalledWith(10);
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  expect(onGo).toHaveBeenLastCalledWith(5);
});

test("says when nothing is found", async () => {
  render(<SearchBar source={source()} onGo={() => {}} onQuery={() => {}} onClose={() => {}} />);
  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "zzz");
  await waitFor(() => expect(screen.getByText("No results")).toBeTruthy());
});

test("a page whose text fails is skipped", async () => {
  render(
    <SearchBar
      source={source({ failTextOn: [5] })}
      onGo={() => {}}
      onQuery={() => {}}
      onClose={() => {}}
    />,
  );
  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "needle");
  await waitFor(() => expect(screen.getByText("1 of 3")).toBeTruthy());
});

test("reports the query and closes on Escape", async () => {
  const onQuery = vi.fn();
  const onClose = vi.fn();
  render(<SearchBar source={source()} onGo={() => {}} onQuery={onQuery} onClose={onClose} />);
  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "ab");
  expect(onQuery).toHaveBeenLastCalledWith("ab");
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});

test("outline lists entries and jumps", async () => {
  const onGo = vi.fn();
  const outline = [
    { title: "Intro", page: 1 },
    { title: "<b>Model</b>", page: 3 },
  ];
  render(<OutlineMenu source={new FakeSource({ outline })} onGo={onGo} />);
  await userEvent.click(await screen.findByRole("button", { name: "Outline" }));
  expect(screen.getByText("<b>Model</b>")).toBeTruthy();
  expect(document.querySelector("b")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "<b>Model</b>" }));
  expect(onGo).toHaveBeenCalledWith(3);
});

test("outline renders nothing when the document has none", async () => {
  const { container } = render(<OutlineMenu source={new FakeSource()} onGo={() => {}} />);
  await new Promise((r) => setTimeout(r, 10));
  expect(container.textContent).toBe("");
});
