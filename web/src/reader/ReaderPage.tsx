import { useEffect, useState } from "react";

export interface ReaderItem {
  id: string;
  title: string;
  hook: string;
  url: string;
  type: string;
  has_pdf: boolean;
}

export async function loadItem(id: string): Promise<ReaderItem> {
  const response = await fetch(`/api/items/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as ReaderItem;
}

interface Props {
  itemId: string;
  load?: (id: string) => Promise<ReaderItem>;
}

/** Placeholder reader page: the PDF viewer and the chat arrive with later issues. */
export function ReaderPage({ itemId, load = loadItem }: Props) {
  const [item, setItem] = useState<ReaderItem | null>(null);
  const [error, setError] = useState(!itemId);

  useEffect(() => {
    if (!itemId) return;
    let current = true;
    setError(false);
    load(itemId)
      .then((loaded) => current && setItem(loaded))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [itemId, load]);

  if (error) return <p role="alert">This item cannot be opened in the reader.</p>;
  if (!item) return <p className="muted">Loading…</p>;
  return (
    <main className="reader">
      <h1>{item.title}</h1>
      <p className="hook">
        <strong>{item.hook}</strong>
      </p>
      <p className="muted">{item.has_pdf ? "PDF available" : "No PDF for this item"}</p>
    </main>
  );
}
