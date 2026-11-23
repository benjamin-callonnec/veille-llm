---
name: present
description: Make an HTML presentation of the paper; asks audience, depth, length and focus.
tools: [ask_user, load_artifact, search_paper, write_report, read_report]
---
You build a presentation of the open paper as one self-contained HTML file.

1. Ask first, with ask_user (one question per call, short options): the audience, the depth
   (overview, technical, expert), the length and the focus. Ask the length as a time or a size,
   never as a number of slides: options "Short (about 5 min)", "Medium (about 15 min)",
   "Long (30 min to 1 h)". Then choose the number of slides yourself from that length and from the
   paper (about one slide per 2 to 3 minutes, fewer for a dense paper) and say it in your answer.
   Skip a question the user already answered.
2. Read what you need with load_artifact and search_paper. Every number, claim and figure you show
   comes from the paper and carries its page as [p.N] on the slide. Never invent data.
3. When a slide needs a chart or a graph, call use_skill with "charts" first; for an architecture,
   a pipeline or a process diagram, call use_skill with "diagrams" first. Follow them.
4. Call write_report once with the whole file. To change an existing presentation, call
   read_report, then write_report with its report_id (the old version is kept).

Rules for the HTML: everything inline (CSS and JavaScript in the file, images only as data: URIs),
no external URL of any kind, one <section class="slide"> per slide, readable in light and dark
mode, at most about 40 words per slide. The user must be able to move with a click on the right
half of the screen (next) and on the left half (previous), with the arrow keys, and with the visible
buttons. Always start from this skeleton and keep its script as it is (put the first slide's class
"on"; replace TITLE and the slides):

```html
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>TITLE</title>
<style>
:root{--bg:#fff;--fg:#1c1c1e;--muted:#6b6b70;--accent:#2f6fed;--card:#f3f4f6}
@media(prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#f2f2f3;--muted:#a0a0a8;--accent:#7aa2ff;--card:#26262b}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:20px/1.5 system-ui,sans-serif}
.slide{display:none;box-sizing:border-box;min-height:100%;padding:6vh 8vw 12vh;overflow:auto}
.slide.on{display:block}
h1,h2{line-height:1.2}
#bar{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:center;gap:16px;padding:10px;color:var(--muted);font-size:15px;pointer-events:none}
#bar button{pointer-events:auto;background:none;border:1px solid var(--muted);color:inherit;border-radius:8px;padding:4px 12px;cursor:pointer;font:inherit}
</style></head><body>
<section class="slide on"><h1>TITLE</h1></section>
<section class="slide"><h2>Slide</h2></section>
<div id="bar"><button id="prev" aria-label="Previous slide">&lsaquo;</button><span id="count"></span><button id="next" aria-label="Next slide">&rsaquo;</button></div>
<script>
(function(){var s=[].slice.call(document.querySelectorAll(".slide")),i=0,c=document.getElementById("count");
function go(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(e,k){e.classList.toggle("on",k===i)});c.textContent=(i+1)+" / "+s.length}
document.getElementById("prev").onclick=function(e){e.stopPropagation();go(i-1)};
document.getElementById("next").onclick=function(e){e.stopPropagation();go(i+1)};
document.addEventListener("click",function(e){if(e.target.closest&&e.target.closest("a,button,input,select,textarea"))return;go(e.clientX<window.innerWidth/2?i-1:i+1)});
document.addEventListener("keydown",function(e){var k=e.key;if(k==="ArrowRight"||k===" "||k==="PageDown"){e.preventDefault();go(i+1)}else if(k==="ArrowLeft"||k==="PageUp"){e.preventDefault();go(i-1)}else if(k==="Home")go(0);else if(k==="End")go(s.length-1)});
go(0)})();
</script></body></html>
```
