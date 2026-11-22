import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CATALOGUE_SHORTCUTS, READER_SHORTCUTS } from "../lib/shortcuts";
import { AppShell } from "./AppShell";

beforeEach(() => document.documentElement.removeAttribute("data-theme"));
afterEach(cleanup);

test("any page inside the shell gets the logo and the settings gear without asking for them", () => {
  render(
    <AppShell shortcuts={CATALOGUE_SHORTCUTS}>
      <p>a page that knows nothing about the chrome</p>
    </AppShell>,
  );
  expect(screen.getByText("a page that knows nothing about the chrome")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("./");
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

test("the same chrome is there for every page, whatever it renders", () => {
  const first = render(
    <AppShell shortcuts={CATALOGUE_SHORTCUTS}>
      <p>one</p>
    </AppShell>,
  );
  const names = (c: HTMLElement) => [
    ...Array.from(c.querySelectorAll("a, button")).map((e) => e.getAttribute("aria-label")),
  ];
  const a = names(first.container);
  cleanup();
  const second = render(
    <AppShell shortcuts={READER_SHORTCUTS}>
      <div>
        <h1>two</h1>
        <p role="alert">even an error page</p>
      </div>
    </AppShell>,
  );
  expect(names(second.container)).toEqual(a);
});

test("an error or loading page still has the way home", () => {
  render(
    <AppShell shortcuts={READER_SHORTCUTS}>
      <p role="alert">This item cannot be opened in the reader.</p>
    </AppShell>,
  );
  expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
});

test("the shortcuts shown are the ones of the page the shell was given", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  render(
    <AppShell shortcuts={CATALOGUE_SHORTCUTS}>
      <p>x</p>
    </AppShell>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("dialog").textContent).toContain("Search the catalogue");
});

test("the shell applies the remembered theme before the page is shown", () => {
  const storage = { getItem: () => "dark", setItem: () => {} } as unknown as Storage;
  render(
    <AppShell shortcuts={CATALOGUE_SHORTCUTS} storage={storage}>
      <p>x</p>
    </AppShell>,
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
});
