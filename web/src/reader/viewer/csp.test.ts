import { expect, test } from "vitest";
import { CSP, withCsp } from "./csp";

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
