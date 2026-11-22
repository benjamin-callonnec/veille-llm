export function parseHash(hash: string): { item: string; page: number | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const page = Number.parseInt(params.get("page") ?? "", 10);
  return {
    item: params.get("item") ?? "",
    page: Number.isInteger(page) && page >= 1 ? page : null,
  };
}

export function writeHash(item: string, page: number | null): string {
  const base = `#item=${encodeURIComponent(item)}`;
  return page !== null && page >= 1 ? `${base}&page=${page}` : base;
}
