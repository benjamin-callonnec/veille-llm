/** The reports the tutor wrote for a paper (HTML, kept locally, one row per version). */
export interface ReportMeta {
  id: number;
  title: string;
  version: number;
  updated_at: string;
}

export interface ReportVersion {
  version: number;
  created_at: string;
}

export interface ReportView {
  id: number;
  title: string;
  version: number;
  versions: ReportVersion[];
  html: string;
}

const base = (item: string) => `/api/items/${encodeURIComponent(item)}/reports`;
const withVersion = (url: string, version?: number) =>
  version === undefined ? url : `${url}?version=${version}`;

export async function listReports(item: string): Promise<ReportMeta[]> {
  try {
    const r = await fetch(base(item));
    if (!r.ok) return [];
    const body = (await r.json()) as unknown;
    return Array.isArray(body) ? (body as ReportMeta[]) : [];
  } catch {
    return [];
  }
}

export async function getReport(
  item: string,
  id: number,
  version?: number,
): Promise<ReportView | null> {
  try {
    const r = await fetch(withVersion(`${base(item)}/${id}`, version));
    return r.ok ? ((await r.json()) as ReportView) : null;
  } catch {
    return null;
  }
}

/** Copy an old version as the newest one; false when the server refused. */
export async function restoreReport(item: string, id: number, version: number): Promise<boolean> {
  try {
    const r = await fetch(`${base(item)}/${id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const exportUrl = (item: string, id: number, version?: number) =>
  withVersion(`${base(item)}/${id}/export`, version);
