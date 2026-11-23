import { afterEach, expect, test, vi } from "vitest";
import { downscale, imagesOf, MAX_SIDE, toPayload } from "./attachments";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = (type = "image/png", size = 1000) =>
  new File([new Uint8Array(size)], "a.png", { type });

/** A canvas whose toBlob gives a blob of `outSize` bytes; the size it was drawn at is kept. */
function stubImage(width: number, height: number, outSize: number) {
  const drawn: number[][] = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height })),
  );
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return real(tag);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_b: unknown, _x: number, _y: number, w: number, h: number) =>
          drawn.push([w, h]),
      }),
      toBlob: (cb: (b: Blob | null) => void, type: string) =>
        cb(new Blob([new Uint8Array(outSize)], { type })),
    };
    return canvas as unknown as HTMLElement;
  });
  return drawn;
}

test("a large image is scaled so that its longer side is MAX_SIDE, keeping the ratio", async () => {
  const drawn = stubImage(4000, 3000, 100);
  const out = await downscale(file("image/png", 5000));
  expect(drawn).toEqual([[MAX_SIDE, Math.round(3000 * (MAX_SIDE / 4000))]]);
  expect(out.size).toBe(100);
  expect(out.type).toBe("image/png");
});

test("a tall large image is scaled on its height", async () => {
  const drawn = stubImage(1000, 3136, 100);
  await downscale(file("image/png", 5000));
  expect(drawn).toEqual([[Math.round(1000 * (MAX_SIDE / 3136)), MAX_SIDE]]);
});

test("a jpeg stays a jpeg and a webp becomes a png", async () => {
  stubImage(4000, 3000, 100);
  expect((await downscale(file("image/jpeg", 5000))).type).toBe("image/jpeg");
  expect((await downscale(file("image/webp", 5000))).type).toBe("image/png");
});

test("an image within the limit is sent unchanged", async () => {
  const drawn = stubImage(MAX_SIDE, 900, 100);
  const original = file("image/png", 5000);
  expect(await downscale(original)).toBe(original);
  expect(drawn).toEqual([]);
});

test("a gif is never redrawn (it would lose its frames)", async () => {
  const drawn = stubImage(4000, 3000, 100);
  const original = file("image/gif", 5000);
  expect(await downscale(original)).toBe(original);
  expect(drawn).toEqual([]);
});

test("the original is kept when scaling does not make it smaller", async () => {
  stubImage(4000, 3000, 9000);
  const original = file("image/png", 5000);
  expect(await downscale(original)).toBe(original);
});

test("the original is kept when the browser cannot decode or encode it", async () => {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      throw new Error("bad image");
    }),
  );
  const original = file();
  expect(await downscale(original)).toBe(original);
  vi.stubGlobal("createImageBitmap", undefined);
  expect(await downscale(original)).toBe(original);
});

test("the payload carries the name, the mime type of what is sent and its base64", async () => {
  vi.stubGlobal("createImageBitmap", undefined);
  const payload = await toPayload(new File(["hi"], "p.png", { type: "image/png" }));
  expect(payload).toEqual({ name: "p.png", mime: "image/png", data: btoa("hi") });
});

test("imagesOf reads files, falls back to items, and keeps images only", () => {
  const png = file();
  const txt = new File(["x"], "a.txt", { type: "text/plain" });
  expect(imagesOf(null)).toEqual([]);
  expect(imagesOf({ files: [png, txt], items: [] } as unknown as DataTransfer)).toEqual([png]);
  const items = [
    { kind: "file", getAsFile: () => png },
    { kind: "string", getAsFile: () => null },
  ];
  expect(imagesOf({ files: [], items } as unknown as DataTransfer)).toEqual([png]);
});
