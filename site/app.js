"use strict";

const state = { data: null, topic: null, query: "", trendingOnly: false };

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function visiblePapers() {
  const query = state.query.trim().toLowerCase();
  return state.data.papers
    .filter((p) => !state.topic || p.topics.includes(state.topic))
    .filter((p) => !state.trendingOnly || p.upvotes > 0)
    .filter((p) => !query || `${p.title} ${p.summary}`.toLowerCase().includes(query))
    .sort((a, b) => b.upvotes - a.upvotes || b.published.localeCompare(a.published));
}

function paperCard(paper) {
  const { topics: labels } = state.data;
  const authors = paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " et al." : "");
  const upvotes = paper.upvotes ? ` · ▲ ${paper.upvotes} sur Hugging Face` : "";
  return el("li", {}, [
    el("h2", {}, [el("a", { href: paper.url, target: "_blank", rel: "noopener", textContent: paper.title })]),
    el("div", { className: "byline", textContent: `${formatDate(paper.published)} · ${authors}${upvotes}` }),
    el("div", { className: "tags" }, paper.topics.map((t) => el("span", { className: "tag", textContent: labels[t] }))),
    el("details", {}, [el("summary", { textContent: "Résumé" }), el("p", { textContent: paper.summary })]),
  ]);
}

function render() {
  const papers = visiblePapers();
  $("count").textContent = `${papers.length} article${papers.length > 1 ? "s" : ""}`;
  $("papers").replaceChildren(...papers.map(paperCard));
  for (const chip of document.querySelectorAll(".chip")) {
    chip.setAttribute("aria-pressed", String((chip.dataset.topic || null) === state.topic));
  }
}

function renderChips() {
  const entries = [["", "Tous"], ...Object.entries(state.data.topics)];
  $("chips").replaceChildren(
    ...entries.map(([topic, label]) => {
      const chip = el("button", { className: "chip", type: "button", textContent: label });
      chip.dataset.topic = topic;
      chip.addEventListener("click", () => {
        state.topic = topic || null;
        render();
      });
      return chip;
    })
  );
}

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(response.status);
    state.data = await response.json();
  } catch (error) {
    $("meta").textContent = "Impossible de charger data.json (lance `make build` puis `make serve`).";
    return;
  }
  $("meta").textContent = `Mis à jour le ${formatDate(state.data.generated_at)} · sources : arXiv (cs.CL, cs.LG, cs.AI) et Hugging Face Papers`;
  $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
  $("trending").addEventListener("change", (e) => { state.trendingOnly = e.target.checked; render(); });
  renderChips();
  render();
}

init();
