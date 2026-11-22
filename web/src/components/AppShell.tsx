import { type ReactNode, useLayoutEffect } from "react";
import type { ShortcutGroup } from "../lib/shortcuts";
import { initTheme } from "../lib/theme";
import { HomeLogo } from "./HomeLogo";
import { SettingsMenu } from "./SettingsMenu";

interface Props {
  /** The keyboard shortcuts of the page, shown in the settings panel. */
  shortcuts: ShortcutGroup[];
  storage?: Storage | null;
  children: ReactNode;
}

/**
 * The frame shared by every page: the logo (home button, fixed top-left) and the settings gear
 * (theme and shortcuts, fixed bottom-left). Pages render only their own content, so a new page
 * gets the same chrome, in the same place, by being put inside the shell.
 */
export function AppShell({ shortcuts, storage, children }: Props) {
  // before the first paint, so a remembered theme never flashes the other one
  useLayoutEffect(() => {
    initTheme(storage === undefined ? undefined : storage);
  }, [storage]);
  return (
    <>
      <HomeLogo />
      <SettingsMenu shortcuts={shortcuts} storage={storage} />
      {children}
    </>
  );
}
