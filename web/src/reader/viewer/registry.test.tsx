import { expect, test } from "vitest";
import { rendererFor } from "./registry";

test("html has a renderer, other types and prototype keys do not", () => {
  expect(rendererFor("html")).not.toBeNull();
  expect(rendererFor("pdf")).toBeNull();
  expect(rendererFor("constructor")).toBeNull();
});
