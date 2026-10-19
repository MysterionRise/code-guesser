import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalBytes } from "./canonical";
import { createCapacityMeter } from "./capacity";
import { parsePreparationArguments } from "./index";
import { openJournal, REDACTED_EMAIL, type JournalMode } from "./journal";
import { loadProfile } from "./command-test-harness";
import { MAINSTREAM_LANGUAGES, type CrawlProfile } from "./profile";
import { createPreparationRuntime } from "./runtime";
import type { WorkerRequest, WorkerResult } from "./stack-metadata";
import { journaledWorker, workerJournalKey } from "./worker-journal";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const journalPath = (): string => join(mkdtempSync(join(tmpdir(), "codeguessr-journal-")), "run.jsonl");
const capacityFor = (profile: CrawlProfile) => createCapacityMeter({ limits: profile.capacity,
  githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: MAINSTREAM_LANGUAGES });
const headers = (profile: CrawlProfile) => ({ accept: "application/vnd.github+json", "x-github-api-version": profile.github.apiVersion });
const commitRequest = (profile: CrawlProfile, sha = "a") => ({ provider: "github", method: "GET", headers: headers(profile),
  url: `https://api.github.com/repos/example/project/commits/${sha.repeat(40)}` });
const searchRequest = (profile: CrawlProfile) => {
  const url = new URL("https://api.github.com/search/commits");
  url.searchParams.set("q", profile.github.queries[0]!.query);
  url.searchParams.set("page", "1");
  return { provider: "github", method: "GET", headers: headers(profile), url: url.href };
};
const accessRequest = { provider: "huggingFace", method: "GET",
  url: "https://huggingface.co/api/datasets/bigcode/the-stack-v2", headers: { accept: "application/json" } };

/** A fetch that answers with a numbered body and counts every live call. */
const countingFetch = () => {
  const state = { calls: 0 };
  const fetchLike = (async () => new Response(JSON.stringify({ sequence: ++state.calls, items: [],
    commit: { author: { name: "Ada", email: "ada@example.test" } } }), {
    status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  return { state, fetchLike };
};
const refusingFetch = (async () => { throw new Error("NETWORK_USED"); }) as typeof fetch;

const runRequests = async (profile: CrawlProfile, mode: JournalMode, path: string, fetchLike: typeof fetch,
  requests: readonly Record<string, unknown>[], discoveryComplete = true) => {
  const capacity = capacityFor(profile);
  const journal = openJournal({ mode, path });
  const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacity, fetchLike, journal);
  const values: unknown[] = [];
  for (const request of requests) values.push(await runtime.transport.requestJson(request as any));
  if (discoveryComplete) journal.markDiscoveryComplete();
  return { values, hashes: [...runtime.hashes], snapshot: capacity.snapshot(), summary: journal.finish() };
};

describe("run journal", () => {
  it("parses the three command forms and rejects anything else", () => {
    expect(parsePreparationArguments([])).toBe("fresh");
    expect(parsePreparationArguments(["--resume"])).toBe("resume");
    expect(parsePreparationArguments(["--offline"])).toBe("offline");
    expect(parsePreparationArguments(["--resume", "--offline"])).toBeUndefined();
    expect(parsePreparationArguments(["--fresh"])).toBeUndefined();
  });

  it("replays a recorded run offline with the same values, hashes, and metering, and no network", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    const live = countingFetch();
    const requests = [accessRequest, searchRequest(profile), commitRequest(profile), commitRequest(profile, "b")];
    const recorded = await runRequests(profile, "fresh", path, live.fetchLike, requests);
    expect(recorded.summary).toEqual({ mode: "fresh", replayed: 0, live: 4 });

    const replayed = await runRequests(profile, "offline", path, refusingFetch, requests);
    expect(replayed.summary).toEqual({ mode: "offline", replayed: 4, live: 0 });
    expect(replayed.hashes).toEqual(recorded.hashes);
    expect(replayed.snapshot.requestCount).toBe(recorded.snapshot.requestCount);
    expect(replayed.snapshot.responseBytes).toBe(recorded.snapshot.responseBytes);
    expect(replayed.snapshot.github).toEqual(recorded.snapshot.github);
    expect((replayed.values[2] as any).sequence).toBe(3);
  });

  it("stores structured e-mail fields redacted but keeps the accepted response hash", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    const live = countingFetch();
    const recorded = await runRequests(profile, "fresh", path, live.fetchLike, [commitRequest(profile)]);
    expect(readFileSync(path, "utf8")).not.toContain("ada@example.test");

    const replayed = await runRequests(profile, "offline", path, refusingFetch, [commitRequest(profile)]);
    expect((replayed.values[0] as any).commit.author).toEqual({ name: "Ada", email: REDACTED_EMAIL });
    expect(replayed.hashes).toEqual(recorded.hashes);
    expect(recorded.hashes[0]).toBe(sha256(canonicalBytes({ sequence: 1, items: [],
      commit: { author: { name: "Ada", email: "ada@example.test" } } })));
  });

  it("fails offline on a response the journal lacks, before any request is metered", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    await runRequests(profile, "fresh", path, countingFetch().fetchLike, [commitRequest(profile)]);
    const capacity = capacityFor(profile);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacity, refusingFetch, openJournal({ mode: "offline", path }));
    await expect(runtime.transport.requestJson(commitRequest(profile, "c") as any)).rejects.toMatchObject({ code: "JOURNAL_MISS" });
    expect(capacity.snapshot().requestCount).toBe(0);
  });

  it("resumes deterministic responses, re-checks access live, and fetches what the journal lacks", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    await runRequests(profile, "fresh", path, countingFetch().fetchLike, [accessRequest, searchRequest(profile), commitRequest(profile)]);
    const live = countingFetch();
    const resumed = await runRequests(profile, "resume", path, live.fetchLike,
      [accessRequest, searchRequest(profile), commitRequest(profile), commitRequest(profile, "d")]);
    // The access check and the new commit are live; the search page and the known commit replay.
    expect(live.state.calls).toBe(2);
    expect(resumed.summary).toEqual({ mode: "resume", replayed: 2, live: 2 });

    const offline = await runRequests(profile, "offline", path, refusingFetch,
      [accessRequest, searchRequest(profile), commitRequest(profile), commitRequest(profile, "d")]);
    expect(offline.hashes).toEqual(resumed.hashes);
  });

  it("searches live on resume when the recorded run did not finish discovery", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    await runRequests(profile, "fresh", path, countingFetch().fetchLike, [searchRequest(profile), commitRequest(profile)], false);
    const live = countingFetch();
    await runRequests(profile, "resume", path, live.fetchLike, [searchRequest(profile), commitRequest(profile)]);
    expect(live.state.calls).toBe(1);
  });

  it("keeps recorded entries a shorter resumed run did not reach", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    await runRequests(profile, "fresh", path, countingFetch().fetchLike,
      [searchRequest(profile), commitRequest(profile), commitRequest(profile, "e")]);
    await runRequests(profile, "resume", path, refusingFetch, [searchRequest(profile)], false);
    const offline = await runRequests(profile, "offline", path, refusingFetch,
      [searchRequest(profile), commitRequest(profile), commitRequest(profile, "e")]);
    expect(offline.summary.replayed).toBe(3);
  });

  it("replays a not-found answer on resume, and any other failure only offline, as the same error and metering", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    const statusFetch = (status: number) => (async () => new Response("{}", { status,
      headers: { "content-type": "application/json" } })) as typeof fetch;
    const record = async (status: number, sha: string) => {
      const capacity = capacityFor(profile);
      const journal = openJournal({ mode: status === 404 ? "fresh" : "resume", path });
      const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacity, statusFetch(status), journal);
      await expect(runtime.transport.requestJson(commitRequest(profile, sha) as any)).rejects.toMatchObject({ code: "UNSUPPORTED_STATUS" });
      journal.markDiscoveryComplete();
      return { summary: journal.finish(), requests: capacity.snapshot().requestCount };
    };
    expect(await record(404, "a")).toEqual({ summary: { mode: "fresh", replayed: 0, live: 1 }, requests: 1 });
    // A refusal is recorded for offline replay, and a resumed run asks again instead of replaying it.
    expect((await record(403, "b")).summary).toEqual({ mode: "resume", replayed: 0, live: 1 });
    expect((await record(403, "b")).summary).toEqual({ mode: "resume", replayed: 0, live: 1 });

    const capacity = capacityFor(profile);
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacity, refusingFetch, openJournal({ mode: "offline", path }));
    await expect(runtime.transport.requestJson(commitRequest(profile, "a") as any))
      .rejects.toMatchObject({ code: "UNSUPPORTED_STATUS", status: 404, diagnostic: { statusClass: "4xx" } });
    await expect(runtime.transport.requestJson(commitRequest(profile, "b") as any))
      .rejects.toMatchObject({ code: "UNSUPPORTED_STATUS", status: 403, diagnostic: { statusClass: "4xx" } });
    await expect(runtime.transport.requestJson(commitRequest(profile, "c") as any)).rejects.toMatchObject({ code: "JOURNAL_MISS" });
    expect(capacity.snapshot().requestCount).toBe(2);
  });

  it("records a rate limit the run could not retry, so an offline replay rejects the same request and a resumed run asks again", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    let calls = 0;
    // GitHub asks for a retry after a second; the caller's retries are spent, so the request is given up.
    const limited = (async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    }) as typeof fetch;
    const journal = openJournal({ mode: "fresh", path });
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), limited, journal);
    await expect(runtime.transport.requestJson(commitRequest(profile, "f") as any)).rejects.toMatchObject({ name: "RetryRequestError" });
    journal.markDiscoveryComplete();
    expect(journal.finish()).toEqual({ mode: "fresh", replayed: 0, live: 1 });

    const offline = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), refusingFetch, openJournal({ mode: "offline", path }));
    await expect(offline.transport.requestJson(commitRequest(profile, "f") as any)).rejects.toMatchObject({ code: "UNSUPPORTED_STATUS", status: 429 });
    const resumed = openJournal({ mode: "resume", path });
    const again = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), limited, resumed);
    await expect(again.transport.requestJson(commitRequest(profile, "f") as any)).rejects.toMatchObject({ name: "RetryRequestError" });
    expect(calls).toBe(2);
  });

  it("prefers a recorded answer to a failure kept for offline replay, and replays a timeout as a timeout", async () => {
    const profile = await loadProfile();
    const path = journalPath();
    let calls = 0;
    // The first and third requests drop on the network; the second, a retry of the first, succeeds.
    const flaky = (async () => {
      calls += 1;
      if (calls !== 2) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const journal = openJournal({ mode: "fresh", path });
    const runtime = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), flaky, journal);
    const causeOf = (error: { cause?: { code?: unknown } }) => error.cause?.code;
    expect(await runtime.transport.requestJson(commitRequest(profile, "d") as any).catch(causeOf)).toBe("NETWORK");
    expect(await runtime.transport.requestJson(commitRequest(profile, "d") as any)).toEqual({ ok: true });
    expect(await runtime.transport.requestJson(commitRequest(profile, "e") as any).catch(causeOf)).toBe("NETWORK");
    journal.finish();

    const offline = createPreparationRuntime(profile, { PATH: "/bin" }, capacityFor(profile), refusingFetch, openJournal({ mode: "offline", path }));
    expect(await offline.transport.requestJson(commitRequest(profile, "d") as any)).toEqual({ ok: true });
    await expect(offline.transport.requestJson(commitRequest(profile, "e") as any)).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("fails closed on a missing, altered, or truncated journal", async () => {
    const profile = await loadProfile();
    expect(() => openJournal({ mode: "resume", path: journalPath() })).toThrow("JOURNAL_MISSING");
    const path = journalPath();
    await runRequests(profile, "fresh", path, countingFetch().fetchLike, [commitRequest(profile), commitRequest(profile, "f")]);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace('"sequence":1', '"sequence":9'));
    expect(() => openJournal({ mode: "offline", path })).toThrow("JOURNAL_CORRUPT");
    writeFileSync(path, original.split("\n").slice(0, 2).join("\n"));
    expect(() => openJournal({ mode: "offline", path })).toThrow("JOURNAL_CORRUPT");
  });

  it("records worker outputs keyed without budgets, replays successes verbatim, and coded failures only offline", async () => {
    const path = journalPath();
    const request = (stdin: Record<string, unknown>): WorkerRequest => ({ command: "uv", args: ["run", "/x/stream_metadata.py"], cwd: "/x",
      environment: {}, stdin: `${JSON.stringify(stdin)}\n`, stdoutByteLimit: 1000, stderrByteLimit: 10 });
    const asked = { configuration: "Python", revision: "r", rowLimit: 10 };
    const first = request({ ...asked, requestLimit: 600, networkByteLimit: 5, temporaryDiskBytes: 7 });
    const later = request({ ...asked, requestLimit: 12, networkByteLimit: 3, temporaryDiskBytes: 1 });
    expect(workerJournalKey(first, "code")).toBe(workerJournalKey(later, "code"));
    expect(workerJournalKey(first, "code")).not.toBe(workerJournalKey(first, "changed-code"));

    const outputs: WorkerResult[] = [
      { exitCode: 1, stdout: new Uint8Array(), stderr: new TextEncoder().encode("NETWORK_LIMIT_REJECTED\n") },
      { exitCode: 0, stdout: new TextEncoder().encode("row\n{\"counters\":{}}\n"), stderr: new Uint8Array() },
    ];
    let runs = 0;
    const run = async (): Promise<WorkerResult> => outputs[runs++]!;
    const journal = openJournal({ mode: "fresh", path });
    expect((await journaledWorker(journal, run, "code")(first)).exitCode).toBe(1);
    expect((await journaledWorker(journal, run, "code")(first)).exitCode).toBe(0);
    const failing = request({ ...asked, configuration: "Ruby" });
    const failed = { exitCode: 1, stdout: new Uint8Array(), stderr: new TextEncoder().encode("SHARD_LISTING_REJECTED\n") };
    expect((await journaledWorker(journal, async () => failed, "code")(failing)).exitCode).toBe(1);
    const unexplained = request({ ...asked, configuration: "Go" });
    await journaledWorker(journal, async () => ({ ...failed, stderr: new TextEncoder().encode("Traceback: secret\n") }), "code")(unexplained);
    expect(journal.finish()).toEqual({ mode: "fresh", replayed: 0, live: 3 });

    // Offline, the coded failure replays as the same exit; an unexplained one was never recorded.
    const replay = openJournal({ mode: "offline", path });
    const spawned = async (): Promise<WorkerResult> => { throw new Error("WORKER_SPAWNED"); };
    const again = await journaledWorker(replay, spawned, "code")(failing);
    expect({ exitCode: again.exitCode, stderr: new TextDecoder().decode(again.stderr) }).toEqual({ exitCode: 1, stderr: "SHARD_LISTING_REJECTED\n" });
    await expect(journaledWorker(replay, spawned, "code")(unexplained)).rejects.toMatchObject({ code: "JOURNAL_MISS" });
    // A resumed run runs the failed worker again.
    let reruns = 0;
    await journaledWorker(openJournal({ mode: "resume", path }), async () => { reruns += 1; return failed; }, "code")(failing);
    expect(reruns).toBe(1);

    const offline = openJournal({ mode: "offline", path });
    const replayed = await journaledWorker(offline, async () => { throw new Error("WORKER_SPAWNED"); }, "code")(later);
    expect(new TextDecoder().decode(replayed.stdout)).toBe("row\n{\"counters\":{}}\n");
    await expect(journaledWorker(offline, run, "changed-code")(later)).rejects.toMatchObject({ code: "JOURNAL_MISS" });
  });
});
