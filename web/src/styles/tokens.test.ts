import { expect, test } from "vitest";
import css from "./tokens.css?raw";

const INVERT = "invert(1) hue-rotate(180deg)";

/** The declarations of the first rule whose selector line matches `selector`. */
const rule = (selector: RegExp): string => {
  const at = css.search(selector);
  expect(at, `${selector} not found in tokens.css`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

test("the PDF pages are inverted in the dark themes only", () => {
  expect(rule(/^:root \{/m)).toContain("--pdf-filter: none");
  expect(rule(/@media \(prefers-color-scheme: dark\) \{\s*:root \{\s*--pdf-filter/)).toContain(
    `--pdf-filter: ${INVERT}`,
  );
  expect(rule(/:root\[data-theme="light"\]/)).toContain("--pdf-filter: none");
  expect(rule(/:root\[data-theme="dark"\]/)).toContain(`--pdf-filter: ${INVERT}`);
});
