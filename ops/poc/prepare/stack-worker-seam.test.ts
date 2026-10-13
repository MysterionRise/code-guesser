import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { blobWorkerRequest, type BlobWorkerLimits } from "./blob-worker";
import { createCapacityMeter } from "./capacity";
import { parseCrawlProfile, STACK_LANGUAGES } from "./profile";
import { metadataWorkerRequest, runLockedWorker, type WorkerRequest } from "./stack-metadata";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profilePath = new URL("../profiles/local-real-rounds.v4.json", import.meta.url);
const hasUv = spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
const SEAM_TIMEOUT_MILLISECONDS = 120_000;

/** Runs the real locked worker in its offline request-check mode; it never opens a network connection. */
const check = async (request: WorkerRequest): Promise<Readonly<{ exitCode: number; stderr: string }>> => {
  const result = await runLockedWorker({ ...request, args: [...request.args, "--check-request"] });
  return { exitCode: result.exitCode, stderr: Buffer.from(result.stderr).toString("utf8") };
};

const withStdin = (request: WorkerRequest, change: (value: Record<string, any>) => void): WorkerRequest => {
  const value = JSON.parse(request.stdin) as Record<string, any>;
  change(value);
  return { ...request, stdin: `${JSON.stringify(value)}\n` };
};

describe.skipIf(!hasUv)("Node to Python worker seam", () => {
  it("each metadata worker accepts the largest request the orchestrator can build", async () => {
    const profile = parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));
    for (const configuration of STACK_LANGUAGES) {
      const capacity = createCapacityMeter({
        limits: profile.capacity,
        githubQueryIds: profile.github.queries.map(({ id }) => id),
        stackLanguages: STACK_LANGUAGES,
      });
      const request = metadataWorkerRequest({
        profile, capacity, configuration, rowLimit: profile.capacity.stackRowsPerLanguage,
        environment: { PATH: process.env.PATH, HF_TOKEN: "offline-request-check" },
        blobAccess: async () => undefined,
      });
      expect(await check(request), configuration).toEqual({ exitCode: 0, stderr: "" });
    }
  }, SEAM_TIMEOUT_MILLISECONDS);

  it("the metadata worker names a budget above its own maximum", async () => {
    const profile = parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));
    const capacity = createCapacityMeter({
      limits: profile.capacity,
      githubQueryIds: profile.github.queries.map(({ id }) => id),
      stackLanguages: STACK_LANGUAGES,
    });
    const request = metadataWorkerRequest({
      profile, capacity, configuration: "Python", rowLimit: profile.capacity.stackRowsPerLanguage,
      environment: { PATH: process.env.PATH, HF_TOKEN: "offline-request-check" },
      blobAccess: async () => undefined,
    });
    const raised = withStdin(request, (value) => { value.requestLimit += 1; });
    expect(await check(raised)).toEqual({ exitCode: 1, stderr: "REQUEST_LIMIT_REJECTED\n" });
  }, SEAM_TIMEOUT_MILLISECONDS);

  it("the blob worker accepts limits at every signed ceiling and names one above", async () => {
    const profile = parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));
    const { capacity } = profile;
    const limits: BlobWorkerLimits = {
      blobAttempts: capacity.blobAttempts, successfulBlobs: capacity.successfulBlobs,
      perBlobBytes: capacity.perBlobBytes, totalBlobBytes: capacity.totalBlobBytes,
      temporaryDiskBytes: capacity.temporaryDiskBytes, requestLimit: capacity.requestCount,
      networkByteLimit: capacity.perBlobBytes,
    };
    const row = {
      stableRowId: "1".repeat(64), swhBlobId: "a".repeat(40), swhContentId: "b".repeat(40),
      sourceEncoding: "UTF-8", byteLength: capacity.perBlobBytes,
    } as any;
    const request = blobWorkerRequest(row, limits, { PATH: process.env.PATH, HOME: process.env.HOME });
    expect(await check(request)).toEqual({ exitCode: 0, stderr: "" });
    const raised = withStdin(request, (value) => { value.limits.requestLimit += 1; });
    expect(await check(raised)).toEqual({ exitCode: 1, stderr: "LIMIT_RAISED\n" });
  }, SEAM_TIMEOUT_MILLISECONDS);
});
