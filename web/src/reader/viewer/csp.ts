/** No network, no frames, no forms, no <base>: the report can only draw itself with what it carries. */
export const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

const META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * The page with the policy as its first element (after the doctype, to stay out of quirks mode).
 * Never searches for <head>: a fake one in a comment could push the policy out of the way.
 */
export function withCsp(html: string, head = ""): string {
  const doctype = DOCTYPE.exec(html);
  const end = doctype ? doctype[0].length : 0;
  return html.slice(0, end) + META + head + html.slice(end);
}

/**
 * The page has the keyboard focus (so the arrows work at once), so V and Escape never reach the
 * app: this tiny script, injected after the policy, passes those two keys up and nothing else.
 * Not while typing in a field, not with a modifier (Cmd+V is a paste).
 */
export const KEY_BRIDGE =
  '<script>(function(){addEventListener("keydown",function(e){if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;var k=e.key;if(k!=="v"&&k!=="V"&&k!=="Escape")return;var t=e.target;if(t&&t.closest&&t.closest("input,textarea,select,[contenteditable]"))return;parent.postMessage({veilleKey:k},"*")},true)})();</script>';
