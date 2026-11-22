import { beforeEach, describe, expect, test, vi } from "vitest";

const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  getDocument: (...a: unknown[]) => getDocument(...a),
  GlobalWorkerOptions: {},
  Util: { transform: (_a: number[], b: number[]) => b },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { openPdf } from "./pdfjsSource";
import { PdfOpenError } from "./source";

beforeEach(() => getDocument.mockReset());

const failWith = (name: string) =>
  getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error("x"), { name })) });

describe("openPdf errors", () => {
  test.each([
    ["PasswordException", "password"],
    ["InvalidPDFException", "invalid"],
    ["MissingPDFException", "network"],
    ["SomethingElse", "network"],
  ])("%s maps to %s", async (name, reason) => {
    failWith(name);
    const err = await openPdf("/x.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(PdfOpenError);
    expect(err.reason).toBe(reason);
  });
});

test("scripting and eval are off and XFA is disabled", async () => {
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1 }),
  });
  await openPdf("/x.pdf");
  const args = getDocument.mock.calls[0]?.[0];
  expect(args.url).toBe("/x.pdf");
  expect(args.isEvalSupported).toBe(false);
  expect(args.enableXfa).toBe(false);
  expect(args.enableScripting).not.toBe(true);
});

test("outline resolves named and direct destinations, skips broken ones", async () => {
  const ref = { num: 4, gen: 0 };
  const doc = {
    numPages: 5,
    getOutline: async () => [
      { title: "Named", dest: "sec1", items: [{ title: "Child", dest: [ref], items: [] }] },
      { title: "Broken", dest: "nope", items: [] },
      { title: "NoDest", dest: null, items: [] },
    ],
    getDestination: async (id: string) => (id === "sec1" ? [ref] : null),
    getPageIndex: async () => 2,
  };
  getDocument.mockReturnValue({ promise: Promise.resolve(doc) });
  const source = await openPdf("/x.pdf");
  expect(await source.outline()).toEqual([
    { title: "Named", page: 3 },
    { title: "Child", page: 3 },
  ]);
});

test("a document without outline gives an empty list", async () => {
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getOutline: async () => null }),
  });
  expect(await (await openPdf("/x.pdf")).outline()).toEqual([]);
});

test("a hostile page cannot produce more than 5000 text boxes", async () => {
  const items = Array.from({ length: 6000 }, (_, i) => ({
    str: `w${i}`,
    transform: [1, 0, 0, 10, 0, 0],
    width: 5,
  }));
  const page = {
    getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0], width: 600, height: 800 }),
    getTextContent: async () => ({ items }),
  };
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
  });
  const source = await openPdf("/x.pdf");
  const { boxes } = await source.textLayer(1);
  expect(boxes).toHaveLength(5000);
});
