import { useEffect, useState } from "react";
import { timeAgo } from "../../lib/time";
import type { SessionApi, TraceTurn } from "./sessionApi";

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const money = (usd: number) => `$${usd < 0.01 && usd > 0 ? "<0.01" : usd.toFixed(2)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The tools of a turn as "search_paper ×2, load_artifact". */
export function toolSummary(tools: TraceTurn["tools"]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
}

/** What each turn of the conversation did: tools, tokens, time and cost. Never the text. */
export function TracePanel({
  itemId,
  conversation,
  api,
  version = 0,
  now,
}: {
  itemId: string;
  conversation: number | null;
  api: SessionApi;
  /** Changes when a turn ended: the trace is read again. */
  version?: number;
  now?: number;
}) {
  const [turns, setTurns] = useState<TraceTurn[] | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` only forces a new read
  useEffect(() => {
    if (conversation === null) {
      setTurns([]);
      return;
    }
    let current = true;
    api
      .trace(itemId, conversation)
      .then((t) => {
        if (!current) return;
        setTurns(t);
        setFailed(false);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [api, itemId, conversation, version]);

  const total = (turns ?? []).reduce(
    (sum, t) => ({
      tokens: sum.tokens + t.input_tokens + t.output_tokens,
      cost: sum.cost + t.cost_usd,
    }),
    { tokens: 0, cost: 0 },
  );
  return (
    <section className="chat-panel" aria-label="Turn trace">
      <p className="panel-title">
        {turns && turns.length > 0
          ? `${turns.length} ${turns.length === 1 ? "turn" : "turns"} · ${compact(total.tokens)} tokens · ${money(total.cost)}`
          : "Turns of this conversation"}
      </p>
      {failed && (
        <p role="alert" className="chat-error panel-note">
          The trace could not be loaded.
        </p>
      )}
      {turns?.length === 0 && <p className="muted panel-empty">Nothing yet.</p>}
      <ol className="trace">
        {(turns ?? []).map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: turns only grow
          <li key={i} className="trace-turn">
            <span className="trace-main">
              {seconds(t.duration_ms)} · {compact(t.input_tokens)} in · {compact(t.output_tokens)}{" "}
              out · {money(t.cost_usd)}
            </span>
            <span className="trace-sub muted">
              {timeAgo(t.created_at, now)}
              {t.cache_read_tokens + t.cache_write_tokens > 0 &&
                ` · cache ${compact(t.cache_read_tokens)} read, ${compact(t.cache_write_tokens)} written`}
              {t.stopped && " · stopped"}
              {t.error_kind && ` · ${t.error_kind}`}
            </span>
            {t.tools.length > 0 && (
              <span className="trace-sub">
                {toolSummary(t.tools)}
                {t.tools.some((x) => x.is_error) && " (some failed)"}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
