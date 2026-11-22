import { useEffect, useRef, useState } from "react";
import { findAll, type Hit } from "./lib/search";
import type { PdfSource } from "./pdf/source";

interface Props {
  source: PdfSource;
  onGo(page: number): void;
  onQuery(query: string): void;
  onClose(): void;
}

const YIELD_EVERY = 5;

export function SearchBar({ source, onGo, onQuery, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const texts = useRef(new Map<number, string>());
  const goRef = useRef(onGo);
  goRef.current = onGo;

  useEffect(() => {
    setHits([]);
    setIndex(0);
    setDone(false);
    if (!query.trim()) return;
    let active = true;
    let jumped = false;
    (async () => {
      for (let p = 1; p <= source.numPages && active; p++) {
        if (!texts.current.has(p)) {
          try {
            texts.current.set(p, (await source.textLayer(p)).text);
          } catch {
            texts.current.set(p, "");
          }
        }
        if (p % YIELD_EVERY === 0 || p === source.numPages) {
          const pages = Array.from({ length: p }, (_, i) => ({
            page: i + 1,
            text: texts.current.get(i + 1) ?? "",
          }));
          if (!active) return;
          const found = findAll(pages, query);
          setHits(found);
          if (!jumped && found[0]) {
            jumped = true;
            goRef.current(found[0].page);
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (active) setDone(true);
    })();
    return () => {
      active = false;
    };
  }, [query, source]);

  const move = (delta: number) => {
    if (!hits.length) return;
    const next = (index + delta + hits.length) % hits.length;
    setIndex(next);
    const hit = hits[next];
    if (hit) onGo(hit.page);
  };

  let status = "";
  if (hits.length) status = `${index + 1} of ${hits.length}`;
  else if (done) status = "No results";

  return (
    <div className="pdf-search">
      <input
        type="search"
        aria-label="Search"
        placeholder="Search in the paper…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            move(e.shiftKey ? -1 : 1);
            e.preventDefault();
          } else if (e.key === "Escape") onClose();
        }}
      />
      <span className="muted">{status}</span>
      <button type="button" aria-label="Close search" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
