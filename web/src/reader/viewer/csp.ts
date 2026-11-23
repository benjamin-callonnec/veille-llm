/** No network, no frames, no forms, no <base>: the report can only draw itself with what it carries. */
export const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

const META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * The page with the policy as its first element (after the doctype, to stay out of quirks mode).
 * Never searches for <head>: a fake one in a comment could push the policy out of the way.
 */
export function withCsp(html: string): string {
  const doctype = DOCTYPE.exec(html);
  if (!doctype) return META + html;
  const end = doctype[0].length;
  return html.slice(0, end) + META + html.slice(end);
}
