/** `0:07`, `1:05`, `62:05`: minutes and two-digit seconds (never NaN or a minus sign). */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
