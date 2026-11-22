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
  if (!mac) return [key];
  switch (key) {
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
