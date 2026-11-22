import { cleanup, render, screen } from "@testing-library/react";
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
