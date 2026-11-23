import { afterEach, beforeEach, expect, test } from "vitest";

const files = import.meta.glob<string>("../../../../skills/present.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const skill = Object.values(files)[0] ?? "";

// The skeleton the /present skill hands to the agent: its navigation must really work.
const html = /```html\n([\s\S]*?)\n```/.exec(skill)?.[1] ?? "";
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

const SLIDES = ["a", "b", "c"];
const shown = () =>
  [...document.querySelectorAll(".slide")].findIndex((e) => e.classList.contains("on"));
const count = () => document.getElementById("count")?.textContent;
const click = (x: number, target: Element = document.body) =>
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x }));
const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  document.body.innerHTML =
    SLIDES.map(
      (s, i) => `<section class="slide${i === 0 ? " on" : ""}"><p>${s}</p></section>`,
    ).join("") +
    `<div id="bar"><button id="prev"></button><span id="count"></span><button id="next"></button></div>`;
  new Function(script)();
});
afterEach(() => {
  document.body.innerHTML = "";
});

test("the skeleton is there and has no external URL", () => {
  expect(html).toContain('class="slide on"');
  expect(script.length).toBeGreaterThan(100);
  expect(html).not.toMatch(/https?:\/\//);
});

test("a click on the right half goes to the next slide, on the left half to the previous", () => {
  expect(count()).toBe("1 / 3");
  click(800);
  expect(shown()).toBe(1);
  click(900);
  expect(shown()).toBe(2);
  click(100);
  expect(shown()).toBe(1);
  expect(count()).toBe("2 / 3");
});

test("it never goes past the first or the last slide", () => {
  click(100);
  expect(shown()).toBe(0);
  click(800);
  click(800);
  click(800);
  expect(shown()).toBe(2);
});

test("arrows, space, page keys, home and end move too", () => {
  key("ArrowRight");
  expect(shown()).toBe(1);
  key(" ");
  expect(shown()).toBe(2);
  key("ArrowLeft");
  expect(shown()).toBe(1);
  key("End");
  expect(shown()).toBe(2);
  key("Home");
  expect(shown()).toBe(0);
  key("PageDown");
  expect(shown()).toBe(1);
  key("PageUp");
  expect(shown()).toBe(0);
});

test("the visible buttons move by one, and a click on a button does not also turn the page", () => {
  document.getElementById("next")?.click();
  expect(shown()).toBe(1);
  document.getElementById("prev")?.click();
  expect(shown()).toBe(0);
});

test("a click on a link inside a slide does not turn the page", () => {
  document.querySelector(".slide")?.insertAdjacentHTML("beforeend", '<a href="#x" id="l">x</a>');
  click(800, document.getElementById("l") as Element);
  expect(shown()).toBe(0);
});
