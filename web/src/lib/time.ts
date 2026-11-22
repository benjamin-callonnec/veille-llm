const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

const valid = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) : null);

/** "Nov 11": the day a message was sent, nothing when the date is unknown. */
export function formatDay(iso: string): string {
  const t = valid(iso);
  if (t === null) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "2 weeks ago", "yesterday", "now": how long ago, nothing when the date is unknown. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = valid(iso);
  if (t === null) return "";
  const seconds = Math.floor((now - t) / 1000);
  if (seconds < 45) return "now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < HOUR) return rtf.format(-Math.max(1, Math.round(seconds / MINUTE)), "minute");
  if (seconds < DAY) return rtf.format(-Math.round(seconds / HOUR), "hour");
  const days = Math.floor(seconds / DAY);
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

/** "claude-sonnet-5-5" reads "Sonnet 5.5". */
export function formatModel(id: string | undefined): string {
  if (!id) return "";
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  if (!match) return id;
  const [, family = "", major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}
