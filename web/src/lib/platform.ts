interface NavigatorLike {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/** True on a Mac keyboard (Option/Return/Fn labels); iPhones and iPads are not. */
export function isMac(nav: NavigatorLike | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const hint = nav.userAgentData?.platform;
  if (hint) return /mac/i.test(hint);
  const platform = nav.platform ?? "";
  if (/iphone|ipad|ipod/i.test(platform) || /iphone|ipad|ipod/i.test(nav.userAgent ?? ""))
    return false;
  if (platform) return /mac/i.test(platform);
  return /macintosh|mac os x/i.test(nav.userAgent ?? "");
}

/** How a key is written on this platform (one key can be several caps, like Fn and an arrow). */
export function keysFor(key: string, mac: boolean): string[] {
  if (!mac) return key === "Mod" ? ["Ctrl"] : [key];
  switch (key) {
    case "Mod":
      return ["⌘"];
    case "Alt":
      return ["⌥"];
    case "Shift":
      return ["⇧"];
    case "Enter":
      return ["Return"];
    case "Esc":
      return ["esc"];
    case "PageUp":
      return ["fn", "↑"];
    case "PageDown":
      return ["fn", "↓"];
    default:
      return [key];
  }
}

/** A combination written for this platform: "⌘B" on a Mac, "Ctrl+B" elsewhere. */
export function combo(keys: string[], mac: boolean): string {
  const caps = keys.flatMap((k) => keysFor(k, mac));
  return mac ? caps.join("") : caps.join("+");
}

interface Modifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Command alone on a Mac, Control alone elsewhere. With Shift or Alt it is a browser shortcut
 * (Cmd+Shift+B shows Chrome's bookmarks bar), so it is left alone.
 */
export function modifierPressed(e: Modifiers, mac: boolean): boolean {
  if (e.altKey || e.shiftKey) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** True when the key goes to a text field, where a letter shortcut must stay a letter. */
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
