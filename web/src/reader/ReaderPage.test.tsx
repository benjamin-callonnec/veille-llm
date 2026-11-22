import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { type ReaderItem, ReaderPage } from "./ReaderPage";

const item = (over: Partial<ReaderItem> = {}): ReaderItem => ({
  id: "a1",
  title: "Agents at scale",
  hook: "A bold hook.",
  url: "https://arxiv.org/abs/2401.01234",
  type: "paper",
  has_pdf: true,
  ...over,
});

afterEach(cleanup);

test("shows title, hook and PDF state", async () => {
  render(<ReaderPage itemId="a1" load={async () => item()} />);
  expect(await screen.findByRole("heading", { name: "Agents at scale" })).toBeTruthy();
  expect(screen.getByText("A bold hook.")).toBeTruthy();
  expect(screen.getByText("PDF available")).toBeTruthy();
});

test("says when there is no PDF", async () => {
  render(<ReaderPage itemId="a1" load={async () => item({ has_pdf: false })} />);
  expect(await screen.findByText("No PDF for this item")).toBeTruthy();
});

test("shows an error when loading fails", async () => {
  render(
    <ReaderPage
      itemId="a1"
      load={async () => {
        throw new Error("404");
      }}
    />,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("shows an error without an item id", async () => {
  render(<ReaderPage itemId="" load={async () => item()} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("a title with markup is rendered as text", async () => {
  render(<ReaderPage itemId="a1" load={async () => item({ title: "<script>x</script>" })} />);
  expect(await screen.findByText("<script>x</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
});
