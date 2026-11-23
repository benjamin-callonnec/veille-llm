import { describe, expect, it } from "vitest";
import { type Deps, dispatchWorkflow, REPO, WORKFLOWS, workflowFor } from "./dispatch";
import { DEFAULT_POLICY } from "./resilience";

const TOKEN = "github_pat_SECRET_VALUE_123";

type Step = Response | Error;

const reply = (status: number) => new Response(status === 204 ? null : "{}", { status });

function setup(steps: Step[]) {
  const logs: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  let index = 0;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  const deps: Deps = {
    token: TOKEN,
    fetchFn,
    log: (line) => logs.push(line),
    policy: DEFAULT_POLICY,
    sleep: async () => {},
    random: () => 0,
  };
  return { deps, logs, requests };
}

async function outcome(steps: Step[]) {
  const { deps, logs, requests } = setup(steps);
  let error: Error | undefined;
  try {
    await dispatchWorkflow("daily.yml", deps);
  } catch (e) {
    error = e as Error;
  }
  return { logs, requests, error };
}

describe("workflowFor", () => {
  it("maps the two crons to their workflow files", () => {
    expect(workflowFor("0 6 * * *")).toBe("daily.yml");
    expect(workflowFor("0 8 * * 1")).toBe("weekly.yml");
    expect(Object.values(WORKFLOWS).sort()).toEqual(["daily.yml", "weekly.yml"]);
  });

  it("refuses a cron it does not know", () => {
    expect(() => workflowFor("* * * * *")).toThrow("unknown cron: * * * * *");
  });
});

describe("dispatchWorkflow", () => {
  it("posts the dispatch of the workflow on main and logs the status", async () => {
    const { logs, requests, error } = await outcome([reply(204)]);
    expect(error).toBeUndefined();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(
      `https://api.github.com/repos/${REPO}/actions/workflows/daily.yml/dispatches`,
    );
    expect(request?.init.method).toBe("POST");
    expect(request?.init.body).toBe('{"ref":"main"}');
    expect(request?.init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "veille-llm-scheduler",
    });
    expect(logs).toEqual(["dispatched daily.yml: HTTP 204"]);
  });

  it("succeeds after one retry on a server error", async () => {
    const { requests, error } = await outcome([reply(500), reply(204)]);
    expect(error).toBeUndefined();
    expect(requests).toHaveLength(2);
  });

  it.each([404, 422])("fails at once on status %i, without a retry", async (status) => {
    const { requests, error } = await outcome([reply(status), reply(204)]);
    expect(error?.message).toBe(`dispatch of daily.yml failed: HTTP ${status}`);
    expect(requests).toHaveLength(1);
  });

  it("fails once the attempts are used up", async () => {
    const { requests, error } = await outcome([reply(500)]);
    expect(error?.message).toBe("dispatch of daily.yml failed: HTTP 500");
    expect(requests).toHaveLength(DEFAULT_POLICY.attempts);
  });

  it.each([
    ["success", [reply(204)]],
    ["unauthorised", [reply(401)]],
    ["not found", [reply(404)]],
    ["server error", [reply(500)]],
    ["network error", [new Error("connection reset")]],
  ] as [string, Step[]][])("never leaks the token (%s)", async (_name, steps) => {
    const { logs, error } = await outcome(steps);
    const everything = [...logs, error?.message ?? "", String(error?.cause ?? "")].join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("Bearer");
  });

  it("turns a network failure into a clear error", async () => {
    const { error } = await outcome([new Error("connection reset")]);
    expect(error?.message).toBe("dispatch of daily.yml failed: network error");
  });
});
