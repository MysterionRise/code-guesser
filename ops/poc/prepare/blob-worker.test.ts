import { readFile } from "node:fs/promises";

import { createCapacityMeter } from "./capacity";
import { parseCrawlProfile } from "./profile";
import { blobWorkerRequest, fetchSelectedBlob, parseBlobWorkerOutput, type BlobWorkerLimits } from "./blob-worker";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profilePath = new URL("../profiles/local-real-rounds.v1.json", import.meta.url);
const runtimeDirectory = new URL("../stack/", import.meta.url).pathname.replace(/\/$/u, "");
const workerPath = `${runtimeDirectory}/fetch_blob.py`;
const row = {
  stableRowId: "1".repeat(64), swhBlobId: "a".repeat(40), swhContentId: "b".repeat(40),
  swhDirectoryId: "c".repeat(40), swhSnapshotId: "d".repeat(40), swhRevisionId: "e".repeat(40),
  repository: "example/project", path: "src/example.py", detectedLicenses: ["MIT"],
  detectedLanguage: "Python", generated: false, vendor: false, sourceEncoding: "UTF-8",
  byteLength: 128, visitDate: "2023-09-06T10:44:38.631000Z",
  revisionDate: "2023-09-05T09:30:00Z", committerDate: "2023-09-05T09:30:00Z",
} as const;
const limits: BlobWorkerLimits = Object.freeze({
  blobAttempts: 50, successfulBlobs: 50, perBlobBytes: 262_144, totalBlobBytes: 16_777_216,
  temporaryDiskBytes: 33_554_432, requestLimit: 200, networkByteLimit: 262_144,
});
const environment = {
  PATH: "/project/bin", HOME: "/external/home", AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret",
  AWS_SESSION_TOKEN: "session", AWS_PROFILE: "poc", AWS_SHARED_CREDENTIALS_FILE: "/external/credentials",
  AWS_CONFIG_FILE: "/external/config", HF_TOKEN: "must-not-cross", GITHUB_TOKEN: "must-not-cross", NODE_OPTIONS: "--inspect",
};
const blob = { stableRowId: row.stableRowId, swhBlobId: row.swhBlobId, contentBase64: "aGVsbG8=", byteLength: 128 };
const counters = (overrides: Record<string, unknown> = {}) => ({
  counters: { networkBytes: 96, peakTemporaryDiskBytes: 0, redirectsFollowed: 0, requests: 1, ...overrides },
});
const output = (...objects: Record<string, unknown>[]): Uint8Array =>
  Buffer.from(objects.map((object) => JSON.stringify(object)).join("\n") + "\n");
const result = (stdout: Uint8Array, exitCode = 0, stderr: Uint8Array = new Uint8Array()) => ({ exitCode, stdout, stderr });

describe("selected-blob worker bridge", () => {
  it("builds a credential-scoped request with non-secret stdin carrying every ceiling", () => {
    const request = blobWorkerRequest(row, limits, environment);

    expect(request).toEqual({
      command: "uv",
      args: ["run", "--project", runtimeDirectory, "--locked", "python", workerPath],
      cwd: runtimeDirectory,
      environment: {
        PATH: "/project/bin", HOME: "/external/home", AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret",
        AWS_SESSION_TOKEN: "session", AWS_PROFILE: "poc", AWS_SHARED_CREDENTIALS_FILE: "/external/credentials",
        AWS_CONFIG_FILE: "/external/config",
      },
      stdin: JSON.stringify({
        rows: [{ stableRowId: row.stableRowId, swhBlobId: row.swhBlobId, swhContentId: row.swhContentId,
          sourceEncoding: "UTF-8", byteLength: 128 }],
        limits,
      }) + "\n",
      stdoutByteLimit: 524_288,
      stderrByteLimit: 4096,
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(() => blobWorkerRequest(row, limits, { HOME: "/external/home" })).toThrow("ENVIRONMENT_REJECTED");
    for (const key of Object.keys(limits) as (keyof BlobWorkerLimits)[]) {
      expect(() => blobWorkerRequest(row, { ...limits, [key]: 0 }, environment)).toThrow("LIMIT_REJECTED");
    }
    expect(() => blobWorkerRequest(row, { ...limits, perBlobBytes: 262_145 }, environment)).toThrow("LIMIT_REJECTED");
  });

  it("parses exactly one result line plus a canonical counters trailer", () => {
    const parsed = parseBlobWorkerOutput(result(output(blob, counters())), row, limits);

    expect(parsed).toEqual({ blob, counters: counters().counters });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.blob)).toBe(true);
  });

  it("rejects exits, stderr, extra or missing lines, identity drift, and over-budget counters", () => {
    const cases = [
      ["WORKER_EXIT", result(output(blob, counters()), 1)],
      ["WORKER_STDERR", result(output(blob, counters()), 0, Buffer.from("Bearer secret"))],
      ["OUTPUT_MALFORMED", result(output(blob))],
      ["OUTPUT_MALFORMED", result(output(blob, blob, counters()))],
      ["OUTPUT_MALFORMED", result(Buffer.from("not-json\n{}\n"))],
      ["OUTPUT_MALFORMED", result(Buffer.from(JSON.stringify(blob)))],
      ["BLOB_IDENTITY_REJECTED", result(output({ ...blob, stableRowId: "2".repeat(64) }, counters()))],
      ["BLOB_IDENTITY_REJECTED", result(output({ ...blob, swhBlobId: "f".repeat(40) }, counters()))],
      ["BLOB_IDENTITY_REJECTED", result(output({ ...blob, byteLength: 129 }, counters()))],
      ["BLOB_IDENTITY_REJECTED", result(output({ ...blob, extra: true }, counters()))],
      ["COUNTERS_REJECTED", result(output(blob, { counters: { requests: 1 } }))],
      ["COUNTERS_REJECTED", result(output(blob, counters({ networkBytes: -1 })))],
      ["TEMPORARY_DISK", result(output(blob, counters({ peakTemporaryDiskBytes: 1 })))],
      ["REDIRECT_REJECTED", result(output(blob, counters({ redirectsFollowed: 1, requests: 2 })))],
      ["BLOB_CAPACITY", result(output(blob, counters({ requests: 201 })))],
      ["NETWORK_BYTES", result(output(blob, counters({ networkBytes: 262_145 })))],
    ] as const;
    for (const [code, workerResult] of cases) {
      expect(() => parseBlobWorkerOutput(workerResult, row, limits)).toThrow(code);
    }
  });

  it("runs the worker, records its requests on the capacity meter, and returns the frozen blob", async () => {
    const profile = parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));
    const capacity = createCapacityMeter({ limits: profile.capacity,
      githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: ["Python", "TypeScript"] });
    const requests: unknown[] = [];

    const fetched = await fetchSelectedBlob({ row, limits, environment, capacity,
      runWorker: async (request) => { requests.push(request); return result(output(blob, counters({ requests: 2 }))); } });

    expect(fetched).toEqual(blob);
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(capacity.snapshot().requestCount).toBe(2);

    for (let index = 0; index < 198; index += 1) capacity.beginRequest().release();
    await expect(fetchSelectedBlob({ row, limits: { ...limits, requestLimit: 1 }, environment, capacity,
      runWorker: async () => result(output(blob, counters({ requests: 1 }))) })).rejects.toThrow("BLOB_CAPACITY");
    await expect(fetchSelectedBlob({ row, limits, environment, capacity,
      runWorker: async () => { throw Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" }); } })).rejects.toThrow("UV_MISSING");
    const hidden = await fetchSelectedBlob({ row, limits, environment, capacity,
      runWorker: async () => { throw new Error("Bearer hidden-token"); } }).catch((error: Error) => error);
    expect((hidden as Error).message).toBe("WORKER_START_FAILED");
  });
});
