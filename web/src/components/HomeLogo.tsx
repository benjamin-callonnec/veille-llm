import { Logo } from "./Logo";

/** The logo, fixed in the top-left corner of every page: it always goes back to the catalogue. */
export function HomeLogo() {
  return (
    <a className="home-logo" href="./" aria-label="Home" title="Home (catalogue)">
      <Logo size={32} />
    </a>
  );
}
