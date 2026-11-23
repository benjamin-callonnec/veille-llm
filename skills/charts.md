---
name: charts
description: Guidelines to draw a readable chart or graph as inline SVG in an HTML report.
tools: []
---
Draw every chart as inline SVG inside the report (no library, no external file, no image URL).
Use only numbers that come from the paper, with their page [p.N]; if you read a value off a figure,
say it is approximate. Never invent or smooth data.

Every chart must have, without exception:
- a title that states the finding (for example "Accuracy on GSM8K, by model size"), not "Figure 1";
- axis labels with units ("Accuracy (%)", "Training cost (GPU-hours)"), and tick labels on a sensible
  scale; bars start at zero; say "log scale" on the axis when it is one; never truncate an axis
  silently;
- a legend as soon as there is more than one series (or label the lines directly); do not rely on
  colour alone: add direct labels, different markers or dash patterns;
- values written on bars or points when there are fewer than about 12;
- a source line under it: "Source: paper [p.N]";
- an accessible name: role="img", a <title> and a <desc> (one sentence on what it shows) as the first
  children of the <svg>, and a viewBox (for example viewBox="0 0 640 360") so it scales; no fixed
  width in pixels.

Style: text at least 14 px in the viewBox, a colour-blind-safe palette (#2f6fed, #e08a00, #1a9e75,
#c4366b, #7a52cc, #6b6b70), grid lines thin and light, and fill="currentColor" or var(--fg) for
text and axes so it works in dark mode. One chart per idea; at most 6 series.

Minimal bar chart to adapt (axes, ticks, labels, legend-free single series):

```html
<svg viewBox="0 0 640 360" role="img" aria-labelledby="t d">
  <title id="t">Accuracy by model size</title>
  <desc id="d">Bars: 7B 61%, 13B 68%, 70B 82%.</desc>
  <g font-size="14" fill="currentColor">
    <text x="320" y="24" text-anchor="middle" font-size="18">Accuracy by model size</text>
    <text x="16" y="180" transform="rotate(-90 16 180)" text-anchor="middle">Accuracy (%)</text>
    <text x="340" y="346" text-anchor="middle">Model size (parameters)</text>
    <line x1="60" y1="300" x2="620" y2="300" stroke="currentColor"/>
    <text x="52" y="304" text-anchor="end">0</text>
    <text x="52" y="64" text-anchor="end">100</text>
    <rect x="100" y="104" width="100" height="196" fill="#2f6fed"/><text x="150" y="98" text-anchor="middle">82</text>
    <text x="150" y="322" text-anchor="middle">70B</text>
  </g>
</svg>
```
