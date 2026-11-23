import { useEffect, useState } from "react";
import { IconButton } from "../components/Icon";
import type { OutlineEntry, PdfSource } from "./pdf/source";

export function OutlineMenu({ source, onGo }: { source: PdfSource; onGo(page: number): void }) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let current = true;
    source
      .outline()
      .then((e) => current && setEntries(e))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [source]);

  if (!entries.length) return null;
  return (
    <div className="pdf-outline">
      <IconButton icon="outline" label="Outline" expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <ul>
          {entries.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: titles can repeat
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onGo(e.page);
                  setOpen(false);
                }}
              >
                {e.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
