import { expect, test } from "vitest";
import { CSP, KEY_BRIDGE, withCsp } from "./csp";

const META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

test("the policy blocks the network, <base> and forms, and keeps inline styles, scripts and data: media", () => {
  expect(CSP).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
  );
});

test("the meta goes right after the doctype, so the page does not fall into quirks mode", () => {
  const html = "<!DOCTYPE html><html><head><title>x</title></head><body>a</body></html>";
  expect(withCsp(html)).toBe(
    `<!DOCTYPE html>${META}<html><head><title>x</title></head><body>a</body></html>`,
  );
});

test("without a doctype the meta comes first", () => {
  expect(withCsp("<p>hi</p>")).toBe(`${META}<p>hi</p>`);
  expect(withCsp("")).toBe(META);
});

test("a fake <head> inside a comment cannot push the policy out of the way", () => {
  const out = withCsp("<!-- <head> --><script>x</script>");
  expect(out.startsWith(META)).toBe(true);
});

test("extra head content goes right after the policy, never before it", () => {
  expect(withCsp("<p>x</p>", "<i></i>")).toBe(`${META}<i></i><p>x</p>`);
  expect(withCsp("<!doctype html><p>x</p>", "<i></i>")).toBe(
    `<!doctype html>${META}<i></i><p>x</p>`,
  );
});

const bridge = /<script>([\s\S]*)<\/script>/.exec(KEY_BRIDGE)?.[1] ?? "";

test("the key bridge tells the parent about V and Escape only, outside fields and modifiers", () => {
  const seen: unknown[] = [];
  const listen = (e: MessageEvent) => seen.push(e.data);
  window.addEventListener("message", listen);
  new Function(bridge)();
  const press = (init: KeyboardEventInit, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  press({ key: "v" });
  press({ key: "V" });
  press({ key: "Escape" });
  press({ key: "x" });
  press({ key: "v", metaKey: true });
  press({ key: "v", ctrlKey: true });
  press({ key: "v", repeat: true });
  const field = document.body.appendChild(document.createElement("input"));
  press({ key: "v" }, field);
  field.remove();
  return new Promise<void>((done) =>
    setTimeout(() => {
      window.removeEventListener("message", listen);
      expect(seen).toEqual([{ veilleKey: "v" }, { veilleKey: "V" }, { veilleKey: "Escape" }]);
      done();
    }, 20),
  );
});
