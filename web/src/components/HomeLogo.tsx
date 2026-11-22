import { Logo } from "./Logo";

/** The logo, at the top-left corner of every page (in the page, not floating): home, the catalogue. */
export function HomeLogo() {
  return (
    <a className="home-logo" href="./" aria-label="Home" title="Home (catalogue)">
      <Logo size={32} />
    </a>
  );
}
