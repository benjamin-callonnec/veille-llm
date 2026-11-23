// HTTP call with retries: a timeout per attempt, exponential backoff with full jitter, Retry-After.
// It only answers « should we retry, and in how long? »; what a final failure means is up to the caller.

export interface RetryPolicy {
  attempts: number; // total number of attempts, the first one included
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number; // per attempt
}

export const DEFAULT_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  timeoutMs: 15000,
};

export type Sleep = (ms: number) => Promise<void>;

interface Options {
  policy: RetryPolicy;
  sleep: Sleep;
  random: () => number;
}

// Transient: timeouts, too many requests, server errors. Anything else (401, 403, 404, 422...)
// would happen again identically, so it is never retried.
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function delayFor(attempt: number, policy: RetryPolicy, random: () => number, response?: Response) {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = ceiling * random(); // full jitter: retries do not synchronise
  const retryAfter = Number(response?.headers.get("retry-after"));
  const hinted = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
  return Math.max(jittered, Math.min(policy.maxDelayMs, hinted));
}

/**
 * Returns the last response (even an error one, so the caller reads its status) or throws the last
 * network error once the attempts are used up.
 */
export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  { policy, sleep, random }: Options,
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(policy.timeoutMs) });
    } catch (error) {
      failure = error;
    }

    const retryable = response ? RETRYABLE.has(response.status) : true;
    if (!retryable || attempt >= policy.attempts) {
      if (response) return response;
      throw failure;
    }
    await response?.body?.cancel();
    await sleep(delayFor(attempt, policy, random, response));
  }
}
