import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { CSP, FRAME_BRIDGE, withCsp } from "./csp";

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

const bridge = /<script>([\s\S]*)<\/script>/.exec(FRAME_BRIDGE)?.[1] ?? "";

// The bridge installs listeners on the window for good: install it once, on one fixed page.
const seen: unknown[] = [];
const listen = (e: MessageEvent) => seen.push(e.data);
const flush = () => new Promise<void>((done) => setTimeout(done, 10));

beforeAll(() => {
  document.body.innerHTML = `
    <p id="text">A [p.4] B [p.5 "an exact quote here"] C [p.6 Figure 2] D [p.7 Table 1.2] E [p.8 Fig. 3] F [p.9 \u201ccurly quote\u201d]</p>
    <ul><li id="claim">Accuracy rises 12% on GSM8K with sampled reasoning [p.11]</li></ul>
    <svg id="chart" viewBox="0 0 10 10"><title>Chart [p.13]</title><text id="label">Accuracy 91% [p.5 Table 2]</text></svg>
    <select id="pick"><option>Option [p.14]</option></select>
    <section id="slide"><style>.card{color:red}</style><div>The cited claim lives in a bare block [p.15]</div></section>
    <p id="pages">Both [p.21, p.22] and [p.23 and p.24], not [p.25, p.x] nor [p.26, ] nor [p.27, p.28 "mixed quote"]</p>
    <p id="plain">No citation here, just [p.x] and [brackets].</p>
    <textarea id="area">[p.9]</textarea>
    <style>/* [p.9] */</style>
    <script type="text/plain">[p.9]</script>`;
  window.addEventListener("message", listen);
  new Function(bridge)();
});
afterAll(() => window.removeEventListener("message", listen));
beforeEach(() => {
  seen.length = 0;
});

const chip = (text: string) =>
  [...document.querySelectorAll<HTMLElement>(".veille-cite")].find((e) => e.textContent === text);

test("every citation form becomes a button with its data", () => {
  const chips = [...document.querySelectorAll<HTMLElement>(".veille-cite")];
  // only the page is shown: the extract, the figure or the table stay in the data of the button
  expect(chips.map((c) => c.textContent)).toEqual([
    "[p.4]",
    "[p.5]",
    "[p.6]",
    "[p.7]",
    "[p.8]",
    "[p.9]",
    "[p.11]",
    "[p.15]",
    "[p.21]",
    "[p.22]",
    "[p.23]",
    "[p.24]",
  ]);
  expect(chips.every((c) => c.getAttribute("role") === "button" && c.tabIndex === 0)).toBe(true);
  expect(chip("[p.5]")?.dataset.q).toBe("an exact quote here");
  expect(chip("[p.6]")?.dataset).toMatchObject({ p: "6", k: "figure", n: "2" });
  expect(chip("[p.7]")?.dataset).toMatchObject({ p: "7", k: "table", n: "1.2" });
  expect(chip("[p.8]")?.dataset).toMatchObject({ p: "8", k: "figure", n: "3" });
  expect(chip("[p.9]")?.dataset.q).toBe("curly quote");
  expect(document.body.textContent).not.toContain("an exact quote here");
});

test("the text around a citation is kept, and other brackets are left alone", () => {
  expect(document.getElementById("text")?.textContent).toContain("A [p.4] B ");
  expect(document.getElementById("plain")?.querySelector(".veille-cite")).toBeNull();
});

test("nothing is wrapped in a textarea, a style or a script", () => {
  expect(document.getElementById("area")?.querySelector(".veille-cite")).toBeNull();
  expect(document.querySelector("style")?.querySelector(".veille-cite")).toBeNull();
  expect(document.querySelector("script")?.querySelector(".veille-cite")).toBeNull();
});

test("a click on a citation tells the parent and does not turn the slide", async () => {
  const bubbled: Event[] = [];
  const onBubble = (e: Event) => bubbled.push(e);
  document.addEventListener("click", onBubble);
  chip("[p.5]")?.click();
  chip("[p.6]")?.click();
  chip("[p.4]")?.click();
  await flush();
  document.removeEventListener("click", onBubble);
  expect(seen).toEqual([
    { veilleCite: { page: 5, quote: "an exact quote here" } },
    { veilleCite: { page: 6, kind: "figure", number: "2" } },
    { veilleCite: { page: 4 } },
  ]);
  expect(bubbled).toEqual([]);
});

test("Enter on a focused citation does the same as a click", async () => {
  chip("[p.4]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flush();
  expect(seen).toEqual([{ veilleCite: { page: 4 } }]);
});

test("a click anywhere else asks the parent to close the preview, and still reaches the page", async () => {
  const bubbled: Event[] = [];
  const onBubble = (e: Event) => bubbled.push(e);
  document.addEventListener("click", onBubble);
  document.getElementById("plain")?.click();
  await flush();
  document.removeEventListener("click", onBubble);
  expect(seen).toEqual([{ veilleCite: null }]);
  expect(bubbled).toHaveLength(1);
});

test("the key bridge tells the parent about V and Escape only, outside fields and modifiers", async () => {
  const press = (init: KeyboardEventInit, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  press({ key: "v" });
  press({ key: "V" });
  press({ key: "Escape" });
  press({ key: "x" });
  press({ key: "v", metaKey: true });
  press({ key: "v", ctrlKey: true });
  press({ key: "v", repeat: true });
  press({ key: "v" }, document.getElementById("area") as HTMLElement);
  await flush();
  expect(seen).toEqual([{ veilleKey: "v" }, { veilleKey: "V" }, { veilleKey: "Escape" }]);
});

test("installing it twice in the same page changes nothing", async () => {
  new Function(bridge)();
  chip("[p.4]")?.click();
  await flush();
  expect(seen).toEqual([{ veilleCite: { page: 4 } }]);
  expect(document.querySelectorAll(".veille-cite")).toHaveLength(12);
});

test("a citation also sends the text around it (without the citations) to find the closest passage", async () => {
  chip("[p.11]")?.click();
  await flush();
  expect(seen).toEqual([
    { veilleCite: { page: 11, context: "Accuracy rises 12% on GSM8K with sampled reasoning" } },
  ]);
});

test("too little text around a citation sends none", async () => {
  chip("[p.4]")?.click(); // "A B C D E F": nothing to look for
  await flush();
  expect(seen).toEqual([{ veilleCite: { page: 4 } }]);
});

test("citations added to the page after it loaded are wrapped too, without looping on the old ones", async () => {
  const before = document.querySelectorAll(".veille-cite").length;
  const late = document.createElement("p");
  late.id = "late";
  late.textContent = 'Built later by the report script [p.12 "a quote written after the load"]';
  document.body.appendChild(late);
  await new Promise((done) => setTimeout(done, 250));
  expect(late.querySelectorAll(".veille-cite")).toHaveLength(1);
  expect(chip("[p.12]")?.dataset.q).toBe("a quote written after the load");
  // the earlier chips were not wrapped again (a chip inside a chip would loop for ever)
  expect(document.querySelectorAll(".veille-cite")).toHaveLength(before + 1);
  expect(document.querySelectorAll(".veille-cite .veille-cite")).toHaveLength(0);
  seen.length = 0;
  chip("[p.12]")?.click();
  await flush();
  expect(seen).toEqual([
    {
      veilleCite: {
        page: 12,
        quote: "a quote written after the load",
        context: "Built later by the report script",
      },
    },
  ]);
});

test("text in an svg, a title or an option is left alone: the label would vanish otherwise", () => {
  expect(document.getElementById("label")?.textContent).toBe("Accuracy 91% [p.5 Table 2]");
  expect(document.querySelector("#chart title")?.textContent).toBe("Chart [p.13]");
  expect(document.getElementById("chart")?.querySelector(".veille-cite")).toBeNull();
  expect(document.getElementById("pick")?.querySelector(".veille-cite")).toBeNull();
});

test("the text around a citation never includes the css or scripts of its slide", async () => {
  chip("[p.15]")?.click();
  await flush();
  expect(seen).toEqual([
    { veilleCite: { page: 15, context: "The cited claim lives in a bare block" } },
  ]);
});

test("a list of pages becomes one button per page, a doubtful list stays as text", async () => {
  const pages = document.getElementById("pages");
  expect([...pages!.querySelectorAll(".veille-cite")].map((e) => e.textContent)).toEqual([
    "[p.21]",
    "[p.22]",
    "[p.23]",
    "[p.24]",
  ]);
  expect(pages?.textContent).toContain('[p.25, p.x] nor [p.26, ] nor [p.27, p.28 "mixed quote"]');
  chip("[p.22]")?.click();
  await flush();
  expect(seen).toEqual([{ veilleCite: { page: 22, context: expect.stringContaining("Both") } }]);
});
