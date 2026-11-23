import { describe, expect, it } from "vitest";
import { fetchWithRetry, type RetryPolicy } from "./resilience";

const POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, timeoutMs: 5000 };
const INIT: RequestInit = {
  method: "POST",
  headers: { "X-Test": "1" },
  body: '{"ref":"main"}',
};

type Step = Response | Error;

function script(steps: Step[]) {
  const inits: (RequestInit | undefined)[] = [];
  let index = 0;
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    inits.push(init);
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { fetchFn, inits, calls: () => index };
}

const reply = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : "body", { status, headers }); // a 204 has no body

function run(steps: Step[], policy: RetryPolicy = POLICY, random = () => 1) {
  const delays: number[] = [];
  const scripted = script(steps);
  const promise = fetchWithRetry(scripted.fetchFn, "https://example.test", INIT, {
    policy,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random,
  });
  return { promise, delays, ...scripted };
}

describe("fetchWithRetry", () => {
  it("returns a success at once, without waiting", async () => {
    const { promise, calls, delays } = run([reply(204)]);
    expect((await promise).status).toBe(204);
    expect(calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries a transient error once, waiting one delay", async () => {
    const { promise, calls, delays } = run([reply(500), reply(204)]);
    expect((await promise).status).toBe(204);
    expect(calls()).toBe(2);
    expect(delays).toEqual([100]);
  });

  it.each([408, 425, 429, 502, 503, 504])("retries status %i", async (status) => {
    const { promise, calls } = run([reply(status), reply(204)]);
    expect((await promise).status).toBe(204);
    expect(calls()).toBe(2);
  });

  it.each([401, 403, 404, 422])(
    "never retries status %i and returns its response",
    async (status) => {
      const { promise, calls, delays } = run([reply(status), reply(204)]);
      expect((await promise).status).toBe(status);
      expect(calls()).toBe(1);
      expect(delays).toEqual([]);
    },
  );

  it("waits at least Retry-After, capped at the maximum delay", async () => {
    const hinted = run([reply(429, { "retry-after": "3" }), reply(204)], POLICY, () => 0);
    await hinted.promise;
    expect(hinted.delays).toEqual([1000]); // 3 s asked, capped at maxDelayMs
    const small = run([reply(429, { "retry-after": "0.5" }), reply(204)], POLICY, () => 0);
    await small.promise;
    expect(small.delays).toEqual([500]);
  });

  it("returns the last response once the attempts are used up", async () => {
    const { promise, calls } = run([reply(500)]);
    expect((await promise).status).toBe(500);
    expect(calls()).toBe(3);
  });

  it("retries a network error and then succeeds", async () => {
    const { promise, calls } = run([new Error("reset"), reply(204)]);
    expect((await promise).status).toBe(204);
    expect(calls()).toBe(2);
  });

  it("throws the last network error when every attempt fails", async () => {
    const { promise, calls } = run([new Error("one"), new Error("two"), new Error("three")]);
    await expect(promise).rejects.toThrow("three");
    expect(calls()).toBe(3);
  });

  it("sends the same init, with a timeout signal, on every attempt", async () => {
    const { promise, inits } = run([reply(500), reply(204)]);
    await promise;
    for (const init of inits) {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe('{"ref":"main"}');
      expect(init?.headers).toEqual({ "X-Test": "1" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
