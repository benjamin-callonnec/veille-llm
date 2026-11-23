import { useEffect, useRef } from "react";
import { isTyping } from "../lib/platform";
import { Logo } from "./Logo";

/**
 * The logo, at the top-left corner of every page (in the page, not floating): home, the catalogue.
 * The H key does the same as a click, unless you are typing or holding a modifier (Cmd+H hides the app).
 */
export function HomeLogo() {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "h" || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) {
        return;
      }
      link.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <a ref={link} className="home-logo" href="./" aria-label="Home" title="Home (catalogue)">
      <Logo size={32} />
    </a>
  );
}
