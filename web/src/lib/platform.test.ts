import { describe, expect, test } from "vitest";
import { combo, isMac, keysFor, modifierPressed } from "./platform";

describe("isMac", () => {
  test("uses the modern platform hint first", () => {
    expect(isMac({ userAgentData: { platform: "macOS" }, platform: "Win32", userAgent: "" })).toBe(
      true,
    );
    expect(
      isMac({ userAgentData: { platform: "Windows" }, platform: "MacIntel", userAgent: "" }),
    ).toBe(false);
  });
  test("falls back to navigator.platform, then to the user agent", () => {
    expect(isMac({ platform: "MacIntel", userAgent: "" })).toBe(true);
    expect(isMac({ platform: "Win32", userAgent: "" })).toBe(false);
    expect(isMac({ platform: "Linux x86_64", userAgent: "X11; Linux" })).toBe(false);
    expect(
      isMac({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)" }),
    ).toBe(true);
  });
  test("an iPad or iPhone has no Option/Alt keyboard layout of its own: not a Mac", () => {
    expect(isMac({ platform: "iPhone", userAgent: "iPhone" })).toBe(false);
  });
  test("an unknown or missing navigator is not a Mac", () => {
    expect(isMac(undefined)).toBe(false);
    expect(isMac({})).toBe(false);
  });
});

describe("keysFor", () => {
  test("Alt is the Option key on a Mac", () => {
    expect(keysFor("Alt", true)).toEqual(["⌥"]);
    expect(keysFor("Alt", false)).toEqual(["Alt"]);
  });
  test("Shift, Enter and Esc use the Mac symbols on a Mac only", () => {
    expect(keysFor("Shift", true)).toEqual(["⇧"]);
    expect(keysFor("Enter", true)).toEqual(["Return"]);
    expect(keysFor("Esc", true)).toEqual(["esc"]);
    expect(keysFor("Shift", false)).toEqual(["Shift"]);
    expect(keysFor("Enter", false)).toEqual(["Enter"]);
    expect(keysFor("Esc", false)).toEqual(["Esc"]);
  });
  test("PageUp and PageDown are Fn plus an arrow on a Mac keyboard", () => {
    expect(keysFor("PageUp", true)).toEqual(["fn", "↑"]);
    expect(keysFor("PageDown", true)).toEqual(["fn", "↓"]);
    expect(keysFor("PageUp", false)).toEqual(["PageUp"]);
  });
  test("other keys are left alone", () => {
    for (const k of ["1", "+", "-", "/", "?", "←", "→"]) {
      expect(keysFor(k, true)).toEqual([k]);
      expect(keysFor(k, false)).toEqual([k]);
    }
  });
});

describe("Mod (Command on a Mac, Control elsewhere)", () => {
  test("is written with the right symbol", () => {
    expect(keysFor("Mod", true)).toEqual(["⌘"]);
    expect(keysFor("Mod", false)).toEqual(["Ctrl"]);
  });
  test("a combination reads naturally on each platform", () => {
    expect(combo(["Mod", "B"], true)).toBe("⌘B");
    expect(combo(["Mod", "B"], false)).toBe("Ctrl+B");
    expect(combo(["Mod", "Shift", "J"], true)).toBe("⌘⇧J");
  });
});

describe("modifierPressed", () => {
  const e = (over: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>) => ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });
  test("Command alone on a Mac, Control alone elsewhere", () => {
    expect(modifierPressed(e({ metaKey: true }), true)).toBe(true);
    expect(modifierPressed(e({ ctrlKey: true }), false)).toBe(true);
  });
  test("the other platform's modifier does nothing", () => {
    expect(modifierPressed(e({ ctrlKey: true }), true)).toBe(false);
    expect(modifierPressed(e({ metaKey: true }), false)).toBe(false);
  });
  test("with Shift or Alt it is a browser shortcut and is left alone", () => {
    expect(modifierPressed(e({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(modifierPressed(e({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });
  test("no modifier at all is not a shortcut", () => {
    expect(modifierPressed(e({}), true)).toBe(false);
    expect(modifierPressed(e({}), false)).toBe(false);
  });
});
