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
 * The script injected into every report, right after the policy. It does two jobs and sends the
 * app nothing else (never HTML: a page, an extract, a figure, the short text around a citation, or a key):
 * - the page has the keyboard focus, so V and Escape never reach the app: they are passed up
 *   (not in a field, not with a modifier: Cmd+V is a paste);
 * - the citations `[p.4]`, `[p.4 "extract"]`, `[p.4 Figure 2]` of the text become buttons (also the
 *   ones the report adds later: the page is watched); a click
 *   or Enter sends the citation up, a click anywhere else tells the app to close its preview.
 * Hand-written JavaScript in a string on purpose: a stringified function would not survive the build.
 */
const BRIDGE_JS = String.raw`(function(){
if(window.__veilleBridge)return;window.__veilleBridge=1;
function post(m){parent.postMessage(m,"*")}
var RE=/\[p\.(\d{1,4})(?:\s+(?:["\u201c]([^"\u201d]{3,300})["\u201d]|(Figure|Table|Fig\.?)\s+(\d+(?:\.\d+)?)))?\s*\]/g;
function around(s){var b=s.closest("li,p,td,th,figcaption,blockquote,h1,h2,h3,h4")||s.closest("section")||s.parentNode;
var c=b&&b.cloneNode?b.cloneNode(true):null;
if(c)c.querySelectorAll("style,script,noscript,title,desc").forEach(function(e){e.remove()});
var t=((c&&c.textContent)||"").replace(/\[p\.[^\]]*\]/g,"").replace(/\s+/g," ").trim();return t.slice(0,400)}
function cite(s){var m={page:+s.getAttribute("data-p")},q=s.getAttribute("data-q"),k=s.getAttribute("data-k"),c=around(s);
if(q)m.quote=q;if(k){m.kind=k;m.number=s.getAttribute("data-n")}if(c.length>=12)m.context=c;post({veilleCite:m})}
function wrapText(){
var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),nodes=[],n;
while((n=w.nextNode())){var par=n.parentNode;
if(!par||!par.closest||par.closest("script,style,textarea,svg,title,option,select,button,noscript,template,.veille-cite"))continue;
if(n.nodeValue.indexOf("[p.")>-1)nodes.push(n)}
nodes.forEach(function(t){var text=t.nodeValue,last=0,frag=document.createDocumentFragment(),m;RE.lastIndex=0;
while((m=RE.exec(text))){frag.appendChild(document.createTextNode(text.slice(last,m.index)));
var s=document.createElement("span");s.className="veille-cite";s.tabIndex=0;s.setAttribute("role","button");
s.setAttribute("data-p",m[1]);if(m[2])s.setAttribute("data-q",m[2]);
if(m[3]){s.setAttribute("data-k",m[3].charAt(0).toLowerCase()==="t"?"table":"figure");s.setAttribute("data-n",m[4])}
s.textContent=m[0];frag.appendChild(s);last=RE.lastIndex}
if(last){frag.appendChild(document.createTextNode(text.slice(last)));t.parentNode.replaceChild(frag,t)}})}
function wrap(){
var st=document.createElement("style");st.textContent=".veille-cite{text-decoration:underline dotted;cursor:pointer}";
(document.head||document.documentElement).appendChild(st);wrapText();
var opts={childList:true,subtree:true,characterData:true},timer=0,mo=new MutationObserver(function(){
clearTimeout(timer);timer=setTimeout(function(){mo.disconnect();wrapText();mo.observe(document.body,opts)},60)});
mo.observe(document.body,opts)}
document.addEventListener("click",function(e){var s=e.target.closest&&e.target.closest(".veille-cite");
if(s){e.stopPropagation();e.preventDefault();cite(s)}else post({veilleCite:null})},true);
addEventListener("keydown",function(e){var t=e.target;
if(e.key==="Enter"&&t&&t.classList&&t.classList.contains("veille-cite")){e.preventDefault();cite(t);return}
if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;var k=e.key;if(k!=="v"&&k!=="V"&&k!=="Escape")return;
if(t&&t.closest&&t.closest("input,textarea,select,[contenteditable]"))return;post({veilleKey:k})},true);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wrap);else wrap()
})();`;

export const FRAME_BRIDGE = `<script>${BRIDGE_JS}</script>`;
