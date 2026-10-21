import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCapacityMeter } from "./capacity";
import { loadProfile } from "./command-test-harness";
import { openJournal } from "./journal";
import { MAINSTREAM_LANGUAGES, type CrawlProfile } from "./profile";
import { createPreparationRuntime, RATE_LIMIT_RESERVE } from "./runtime";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const NOW = Date.UTC(2026, 9, 20, 15, 0);
/** A core window that resets in an hour, and one that resets within the fifteen-second wait ceiling. */
const FAR_RESET = NOW / 1000 + 3600;
const NEAR_RESET = NOW / 1000 + 10;

const capacityFor = (profile: CrawlProfile) => createCapacityMeter({ limits: profile.capacity,
  githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: MAINSTREAM_LANGUAGES });
const headers = (profile: CrawlProfile) => ({ accept: "application/vnd.github+json", "x-github-api-version": profile.github.apiVersion });
const commitRequest = (profile: CrawlProfile, sha: string) => ({ provider: "github", method: "GET", headers: headers(profile),
  url: `https://api.github.com/repos/example/project/commits/${sha.repeat(40)}` }) as any;
const searchRequest = (profile: CrawlProfile) => {
  const url = new URL("https://api.github.com/search/commits");
  url.searchParams.set("q", profile.github.queries[0]!.query);
  url.searchParams.set("page", "1");
  return { provider: "github", method: "GET", headers: headers(profile), url: url.href } as any;
};
const accessRequest = { provider: "huggingFace", method: "GET",
  url: "https://huggingface.co/api/datasets/bigcode/the-stack-v2", headers: { accept: "application/json" } } as any;

/** A GitHub that answers each request with the next rate-limit headers in `windows`, repeating the last, after its delay. */
const limitedFetch = (windows: readonly Readonly<{ remaining: number; reset: number; status?: number; delay?: number }>[]) => {
  const state = { calls: 0 };
  const fetchLike = (async (url: string | URL) => {
    const { remaining, reset, status = 200, delay = 0 } = windows[Math.min(state.calls, windows.length - 1)]!;
    state.calls += 1;
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
    const resource = new URL(String(url)).pathname === "/search/commits" ? "search" : "core";
    return new Response(JSON.stringify({ sequence: state.calls, items: [] }), { status, headers: {
      "content-type": "application/json", "x-ratelimit-resource": resource,
      "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": String(reset),
    } });
  }) as typeof fetch;
  return { state, fetchLike };
};

describe("rate-limit checkpoints in the runtime (#165)", () => {
  it(`holds back a live GitHub request once ${RATE_LIMIT_RESERVE} or fewer core requests are left and the window resets beyond the wait ceiling`, async () => {
    const profile = await loadProfile();
    const capacity = capacityFor(profile);
    const live = limitedFetch([{ remaining: RATE_LIMIT_RESERVE + 1, reset: FAR_RESET }, { remaining: RATE_LIMIT_RESERVE, reset: FAR_RESET }]);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacity, live.fetchLike, undefined, { now: () => NOW });
    await runtime.transport.requestJson(commitRequest(profile, "a"));
    await runtime.transport.requestJson(commitRequest(profile, "b"));

    await expect(runtime.transport.requestJson(commitRequest(profile, "c")))
      .rejects.toMatchObject({ name: "RetryError", code: "RATE_LIMIT_CHECKPOINT", resetAt: FAR_RESET * 1000 });
    expect(live.state.calls).toBe(2);
    expect(capacity.snapshot().requestCount).toBe(2);
    // A response the run already holds needs no request; search pages and the Stack access check draw on other limits.
    expect(await runtime.transport.requestJson(commitRequest(profile, "a"))).toMatchObject({ sequence: 1 });
    await runtime.transport.requestJson(searchRequest(profile));
    await runtime.transport.requestJson(accessRequest);
    expect(live.state.calls).toBe(4);
  });

  it("sends a request near the limit when the window resets within the wait ceiling", async () => {
    const profile = await loadProfile();
    const live = limitedFetch([{ remaining: 1, reset: NEAR_RESET }]);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), live.fetchLike, undefined, { now: () => NOW });
    await runtime.transport.requestJson(commitRequest(profile, "a"));
    await runtime.transport.requestJson(commitRequest(profile, "b"));
    expect(live.state.calls).toBe(2);
  });

  it("keeps the lowest count a window reported, so a slower or older response cannot raise it", async () => {
    const profile = await loadProfile();
    // Three requests in flight: the last one sent answers first, then one from the same window, then one from the last window.
    const live = limitedFetch([
      { remaining: 4000, reset: FAR_RESET - 3600, delay: 20 }, { remaining: 4000, reset: FAR_RESET, delay: 10 }, { remaining: 20, reset: FAR_RESET },
    ]);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), live.fetchLike, undefined, { now: () => NOW });
    await Promise.all(["a", "b", "c"].map((sha) => runtime.transport.requestJson(commitRequest(profile, sha))));
    await expect(runtime.transport.requestJson(commitRequest(profile, "d"))).rejects.toMatchObject({ code: "RATE_LIMIT_CHECKPOINT" });
    expect(live.state.calls).toBe(3);
  });

  it("replays recorded responses on resume although the core limit is spent, and holds back only live requests", async () => {
    const profile = await loadProfile();
    const path = join(mkdtempSync(join(tmpdir(), "codeguessr-runtime-")), "run.jsonl");
    const recorded = openJournal({ mode: "fresh", path });
    const first = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile),
      limitedFetch([{ remaining: 4000, reset: FAR_RESET }]).fetchLike, recorded, { now: () => NOW });
    await first.transport.requestJson(commitRequest(profile, "a"));
    recorded.markDiscoveryComplete();
    recorded.finish();

    const live = limitedFetch([{ remaining: 0, reset: FAR_RESET }]);
    const resumed = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), live.fetchLike,
      openJournal({ mode: "resume", path }), { now: () => NOW });
    await resumed.transport.requestJson(commitRequest(profile, "b"));
    expect(await resumed.transport.requestJson(commitRequest(profile, "a"))).toMatchObject({ sequence: 1 });
    await expect(resumed.transport.requestJson(commitRequest(profile, "c"))).rejects.toMatchObject({ code: "RATE_LIMIT_CHECKPOINT" });
    expect(live.state.calls).toBe(1);
  });

  it("turns a refused rate-limit retry into a checkpoint that keeps the 403, records nothing, and holds back the next request", async () => {
    const profile = await loadProfile();
    const path = join(mkdtempSync(join(tmpdir(), "codeguessr-runtime-")), "run.jsonl");
    const journal = openJournal({ mode: "fresh", path });
    const live = limitedFetch([{ remaining: 0, reset: FAR_RESET, status: 403 }]);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), live.fetchLike, journal, { now: () => NOW });
    const refused = await runtime.retry.execute(() => runtime.transport.requestJson(commitRequest(profile, "a"))).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "RATE_LIMIT_CHECKPOINT", resetAt: FAR_RESET * 1000,
      cause: { code: "UNSUPPORTED_STATUS", status: 403, diagnostic: { statusClass: "4xx" } } });
    await expect(runtime.transport.requestJson(commitRequest(profile, "b"))).rejects.toMatchObject({ code: "RATE_LIMIT_CHECKPOINT" });
    expect(live.state.calls).toBe(1);
    expect(runtime.retry.state()).toEqual({ retries: 0, waitedMilliseconds: 0 });
    expect(journal.finish()).toEqual({ mode: "fresh", replayed: 0, live: 0 });
  });
});

describe("interrupted runs", () => {
  it("stops at the next request, live or replayed, without sending it", async () => {
    const profile = await loadProfile();
    const controller = new AbortController();
    const live = limitedFetch([{ remaining: 4000, reset: FAR_RESET }]);
    const capacity = capacityFor(profile);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacity, live.fetchLike, undefined, { signal: controller.signal });
    await runtime.transport.requestJson(commitRequest(profile, "a"));
    expect(() => runtime.stopIfInterrupted()).not.toThrow();
    controller.abort();
    await expect(runtime.transport.requestJson(commitRequest(profile, "b"))).rejects.toMatchObject({ code: "RUN_INTERRUPTED" });
    await expect(runtime.transport.requestJson(commitRequest(profile, "a"))).rejects.toMatchObject({ code: "RUN_INTERRUPTED" });
    expect(() => runtime.stopIfInterrupted()).toThrow("RUN_INTERRUPTED");
    expect(live.state.calls).toBe(1);
    expect(capacity.snapshot().requestCount).toBe(1);
  });
});
