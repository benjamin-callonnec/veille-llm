import { dispatchWorkflow, workflowFor } from "./dispatch";
import { DEFAULT_POLICY } from "./resilience";

interface Env {
  GITHUB_TOKEN: string;
}

export default {
  // Awaited, not left to waitUntil: a failed dispatch must fail the invocation, visibly.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const workflow = workflowFor(controller.cron);
    if (!env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN is not set: wrangler secret put GITHUB_TOKEN");
    }
    await dispatchWorkflow(workflow, {
      token: env.GITHUB_TOKEN,
      fetchFn: fetch,
      log: (line) => console.log(line),
      policy: DEFAULT_POLICY,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
    });
  },
} satisfies ExportedHandler<Env>;
