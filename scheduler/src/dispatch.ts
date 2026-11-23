import { fetchWithRetry, type RetryPolicy, type Sleep } from "./resilience";

export const REPO = "benjamin-callonnec/veille-llm";

// The crons that Terraform sets (iac/main.tf); tests/harness/test_scheduler_crons.py keeps both in step.
export const WORKFLOWS: Record<string, string> = {
  "0 6 * * *": "daily.yml",
  "0 8 * * 1": "weekly.yml",
};

export function workflowFor(cron: string): string {
  const workflow = WORKFLOWS[cron];
  if (!workflow) throw new Error(`unknown cron: ${cron}`);
  return workflow;
}

export interface Deps {
  token: string;
  fetchFn: typeof fetch;
  log(line: string): void;
  policy: RetryPolicy;
  sleep: Sleep;
  random(): number;
}

/** Ask GitHub to run a workflow on main. Nothing here ever logs or throws the token. */
export async function dispatchWorkflow(workflow: string, deps: Deps): Promise<void> {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "veille-llm-scheduler",
    },
    body: JSON.stringify({ ref: "main" }),
  };
  let response: Response;
  try {
    response = await fetchWithRetry(deps.fetchFn, url, init, deps);
  } catch {
    throw new Error(`dispatch of ${workflow} failed: network error`);
  }
  if (response.status !== 204) {
    throw new Error(`dispatch of ${workflow} failed: HTTP ${response.status}`);
  }
  deps.log(`dispatched ${workflow}: HTTP ${response.status}`);
}
