import { useCallback, useEffect, useState } from "react";
import { listReports, type ReportMeta } from "./reportsApi";

/** The reports of a paper, newest first; `reload` reads them again and returns them. */
export function useReports(
  itemId: string,
  list: (item: string) => Promise<ReportMeta[]> = listReports,
) {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const reload = useCallback(async () => {
    const found = await list(itemId);
    setReports(found);
    return found;
  }, [itemId, list]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per paper
  useEffect(() => {
    void reload();
  }, [itemId]);
  return { reports, reload };
}
