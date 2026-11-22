const memory = new Map<string, string>();
const PREFIX = "reader-draft:";

/** The unsent text of a conversation: kept in memory, and in sessionStorage when it works. */
export function loadDraft(key: string): string {
  const known = memory.get(key);
  if (known !== undefined) return known;
  try {
    return sessionStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(key: string, text: string): void {
  if (text) memory.set(key, text);
  else memory.delete(key);
  try {
    if (text) sessionStorage.setItem(PREFIX + key, text);
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    // storage can be blocked: the in-memory copy is enough
  }
}

/** For tests: forget everything held in memory. */
export function resetDrafts(): void {
  memory.clear();
}
