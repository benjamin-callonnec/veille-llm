import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { HomeLogo } from "./HomeLogo";

afterEach(cleanup);

test("the logo is a link to the home page, which is the catalogue", () => {
  render(<HomeLogo />);
  const link = screen.getByRole("link", { name: "Home" });
  expect(link.getAttribute("href")).toBe("./");
  expect(link.getAttribute("title")).toBe("Home (catalogue)");
  expect(link.className).toContain("home-logo");
  expect(link.querySelector("svg")).not.toBeNull();
  expect(link.textContent).toBe("Lw");
});

// jsdom does not navigate: count the clicks the shortcut makes on the link instead
const clicks = () => {
  let count = 0;
  const link = screen.getByRole("link", { name: "Home" });
  link.addEventListener("click", (e) => {
    e.preventDefault();
    count++;
  });
  return () => count;
};

test("H goes home, like a click on the logo", () => {
  render(<HomeLogo />);
  const count = clicks();
  fireEvent.keyDown(window, { key: "h" });
  fireEvent.keyDown(window, { key: "H" });
  expect(count()).toBe(2);
});

test("H is left alone when typing or with a modifier", () => {
  render(
    <>
      <HomeLogo />
      <input aria-label="field" />
    </>,
  );
  const count = clicks();
  fireEvent.keyDown(screen.getByLabelText("field"), { key: "h" });
  fireEvent.keyDown(window, { key: "h", ctrlKey: true });
  fireEvent.keyDown(window, { key: "h", metaKey: true });
  fireEvent.keyDown(window, { key: "h", altKey: true });
  fireEvent.keyDown(window, { key: "x" });
  fireEvent.keyDown(window, { key: "h", repeat: true }); // a held key is one press
  expect(count()).toBe(0);
});
