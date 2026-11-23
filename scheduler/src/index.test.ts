import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

afterEach(() => vi.unstubAllGlobals());

const run = (cron: string, token: string) =>
  worker.scheduled({ cron } as ScheduledController, { GITHUB_TOKEN: token });

describe("scheduled", () => {
  it("dispatches the workflow of the cron that fired", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await run("0 8 * * 1", "t");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/workflows/weekly.yml/dispatches");
  });

  it("fails loudly without the secret, and calls nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(run("0 6 * * *", "")).rejects.toThrow("GITHUB_TOKEN is not set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly on a cron it does not know, and calls nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(run("* * * * *", "t")).rejects.toThrow("unknown cron");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
