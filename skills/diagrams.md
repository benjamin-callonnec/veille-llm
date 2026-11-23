---
name: diagrams
description: Guidelines to draw a clear architecture, pipeline or process diagram as inline SVG in an HTML report.
tools: []
---
Draw diagrams as inline SVG in the report, in the conventions of a clean draw.io diagram. The report
cannot load draw.io or any library, so write the SVG yourself. Only show components, steps and links
the paper describes, with the page [p.N] in the caption; never invent a component.

Every diagram must have, without exception:
- a title that says what it shows ("Training pipeline of X"), and a caption line with the source;
- a label on every box and on every arrow that is not obvious (what flows: "tokens", "gradients");
- a legend whenever colours, dashes or shapes carry meaning (for example: solid arrow = data flow,
  dashed = optional path, blue = model, grey = data store), and units where a size or a rate appears;
- a single reading direction (left to right for pipelines, top to bottom for layers) and a layout on
  a grid: boxes aligned, equal spacing, no overlap, no crossing arrows when it can be avoided;
- an accessible name: role="img", a <title> and a <desc> as the first children of the <svg>, and a
  viewBox (for example viewBox="0 0 800 400") so it scales.

Keep it small: at most about 12 boxes per diagram; split bigger systems into several slides (an
overview, then one slide per part). Group related boxes in a larger rounded rectangle with its own
label. One shape per meaning: rounded rectangle = component, cylinder or "database" label = store,
diamond = decision. Text at least 14 px in the viewBox, centred in its box, with fill="currentColor"
(dark mode); box fills from #2f6fed, #1a9e75, #e08a00, #6b6b70 with white text, or a light card colour
with a thin stroke.

Building blocks (define the arrow head once per diagram):

```html
<svg viewBox="0 0 800 220" role="img" aria-labelledby="t d">
  <title id="t">Retrieval pipeline</title>
  <desc id="d">The query goes to a retriever, then a reader that writes the answer.</desc>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
  <g font-size="14" fill="currentColor" text-anchor="middle">
    <text x="400" y="24" font-size="18">Retrieval pipeline</text>
    <rect x="40" y="80" width="160" height="60" rx="10" fill="#2f6fed"/><text x="120" y="116" fill="#fff">Retriever</text>
    <rect x="320" y="80" width="160" height="60" rx="10" fill="#1a9e75"/><text x="400" y="116" fill="#fff">Reader</text>
    <line x1="200" y1="110" x2="316" y2="110" stroke="currentColor" stroke-width="2" marker-end="url(#a)"/>
    <text x="258" y="102">top-5 passages</text>
  </g>
</svg>
```
