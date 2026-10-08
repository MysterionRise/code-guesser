import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createCapacityMeter } from "./capacity";
import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const sourceModulePath: string = "./stack-metadata";
const metadataModule = await import(sourceModulePath).catch(() => ({})) as Record<string, unknown>;
const collectStackMetadata = typeof metadataModule.collectStackMetadata === "function"
  ? metadataModule.collectStackMetadata as (...args: any[]) => Promise<any>
  : async (): Promise<never> => { throw new Error("STACK_METADATA_NOT_IMPLEMENTED"); };

const profilePath = new URL("../profiles/local-real-rounds.v1.json", import.meta.url);
const runtimeDirectory = new URL("../stack/", import.meta.url);
const lockPath = new URL("uv.lock", runtimeDirectory);
const pythonPath = new URL(".python-version", runtimeDirectory);
const workerPath = new URL("stream_metadata.py", runtimeDirectory);

const loadProfile = async () => parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));

const metadataRow = (overrides: Record<string, unknown> = {}) => {
  const { stableRowId, ...fieldOverrides } = overrides;
  const fields = {
    swhBlobId: "a".repeat(40),
    swhContentId: "b".repeat(40),
    swhDirectoryId: "c".repeat(40),
    swhSnapshotId: "d".repeat(40),
    swhRevisionId: "e".repeat(40),
    repository: "example/project",
    path: "src/example.py",
    detectedLicenses: ["MIT"],
    detectedLanguage: "Python",
    generated: false,
    vendor: false,
    sourceEncoding: "UTF-8",
    byteLength: 128,
    visitDate: "2023-09-06T10:44:38.631000Z",
    revisionDate: "2023-09-05T09:30:00Z",
    committerDate: "2023-09-05T09:30:00Z",
    ...fieldOverrides,
  };
  const canonical = JSON.stringify(Object.fromEntries(Object.keys(fields).sort()
    .map((key) => [key, fields[key as keyof typeof fields]])));
  return {
    stableRowId: stableRowId ?? createHash("sha256").update(canonical).digest("hex"),
    ...fields,
  };
};

const counters = (overrides: Record<string, unknown> = {}) => ({
  counters: { networkBytes: 4096, peakTemporaryDiskBytes: 1024, redirectsFollowed: 0, requests: 3, rowsInspected: 1, ...overrides },
});
const lines = (...objects: Record<string, unknown>[]): Uint8Array =>
  Buffer.from(objects.map((object) => JSON.stringify(object)).join("\n") + "\n");
const ndjson = (...rows: Record<string, unknown>[]): Uint8Array => lines(...rows, counters());

const setup = async (overrides: Record<string, unknown> = {}) => {
  const profile = await loadProfile();
  const capacity = createCapacityMeter({
    limits: profile.capacity,
    githubQueryIds: profile.github.queries.map(({ id }) => id),
    stackLanguages: ["Python", "TypeScript"],
  });
  return {
    profile,
    capacity,
    configuration: "Python",
    rowLimit: 1,
    environment: {
      PATH: "/project/bin:/usr/bin",
      HF_TOKEN: "external-hf-token",
      AWS_ACCESS_KEY_ID: "must-not-cross",
      AWS_SECRET_ACCESS_KEY: "must-not-cross",
      GITHUB_TOKEN: "must-not-cross",
      NODE_OPTIONS: "--inspect",
      PYTHONPATH: "/untrusted",
    },
    runWorker: async () => ({ exitCode: 0, stdout: ndjson(metadataRow()), stderr: new Uint8Array() }),
    blobAccess: async () => undefined,
    ...overrides,
  };
};

const expectBeforeBlob = async (code: string, overrides: Record<string, unknown>) => {
  let blobCalls = 0;
  await expect(collectStackMetadata(await setup({
    ...overrides,
    blobAccess: async () => { blobCalls += 1; },
  }))).rejects.toMatchObject({ code });
  expect(blobCalls).toBe(0);
};

describe("Stack metadata worker bridge", () => {
  it("accepts only the corrected provider-derived date and encoding projection", async () => {
    const rows = await collectStackMetadata(await setup({
      runWorker: async () => ({
        exitCode: 0,
        stdout: ndjson(metadataRow()),
        stderr: new Uint8Array(),
      }),
    }));

    expect(rows).toEqual([metadataRow()]);
    expect(rows[0]).not.toHaveProperty("firstCrawlDate");
    expect(rows[0]).not.toHaveProperty("lastCrawlDate");
    expect(Object.isFrozen(rows[0].detectedLicenses)).toBe(true);
  });

  it("rejects noncanonical NDJSON and duplicate JSON keys", async () => {
    const row = metadataRow();
    const canonical = JSON.stringify(row);
    const prefix = `{"stableRowId":"${row.stableRowId}"`;
    const trailer = `${JSON.stringify(counters())}\n`;
    const spaced = Buffer.from(canonical.replace(",\"swhBlobId\"", ", \"swhBlobId\"") + "\n" + trailer);
    const duplicated = Buffer.from(canonical.replace(
      prefix,
      `${prefix},"stableRowId":"${row.stableRowId}"`,
    ) + "\n" + trailer);
    for (const stdout of [spaced, duplicated]) {
      await expectBeforeBlob("OUTPUT_NONCANONICAL", {
        runWorker: async () => ({ exitCode: 0, stdout, stderr: new Uint8Array() }),
      });
    }
  });

  it("rejects impossible calendar dates even when the JavaScript parser normalizes them", async () => {
    await expectBeforeBlob("ROW_DATE_REJECTED", {
      runWorker: async () => ({
        exitCode: 0,
        stdout: ndjson(metadataRow({ visitDate: "2023-02-30T09:30:00Z" })),
        stderr: new Uint8Array(),
      }),
    });
  });

  it("spawns only the locked uv worker with non-secret stdin and a credential-scoped environment", async () => {
    const calls: any[] = [];
    const rows = await collectStackMetadata(await setup({
      runWorker: async (request: unknown) => {
        calls.push(request);
        return { exitCode: 0, stdout: ndjson(metadataRow()), stderr: new Uint8Array() };
      },
    }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: "uv",
      args: [
        "run", "--project", runtimeDirectory.pathname.replace(/\/$/u, ""), "--locked",
        "python", workerPath.pathname,
      ],
      cwd: runtimeDirectory.pathname.replace(/\/$/u, ""),
      environment: { PATH: "/project/bin:/usr/bin", HF_TOKEN: "external-hf-token" },
      stdin: JSON.stringify({
        configuration: "Python",
        revision: "e565caa3a78c2423bd374333a472b049eb090e47",
        rowLimit: 1,
        perBlobByteLimit: 262_144,
        requestLimit: 200,
        networkByteLimit: 67_108_864,
        temporaryDiskBytes: 33_554_432,
      }) + "\n",
      stdoutByteLimit: 67_108_864,
      stderrByteLimit: 4096,
    });
    expect(rows).toEqual([metadataRow()]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it("passes only the remaining request, network-byte, and temporary-disk budgets to the worker", async () => {
    const calls: any[] = [];
    const options = await setup({
      configuration: "TypeScript",
      runWorker: async (request: unknown) => {
        calls.push(request);
        return { exitCode: 0, stdout: ndjson(metadataRow({ detectedLanguage: "TypeScript", path: "src/example.ts" })), stderr: new Uint8Array() };
      },
    });
    for (let index = 0; index < 5; index += 1) options.capacity.beginRequest().release();
    options.capacity.recordStackRows("Python", 1, 1000);
    const release = options.capacity.reserveTemporaryDisk(1024);

    await collectStackMetadata(options);
    release();

    expect(JSON.parse(calls[0].stdin)).toMatchObject({
      requestLimit: 195,
      networkByteLimit: 67_107_864,
      temporaryDiskBytes: 33_553_408,
    });
    expect(calls[0].stdoutByteLimit).toBe(67_107_864);

    let spawns = 0;
    const exhausted = await setup({ runWorker: async () => { spawns += 1; return { exitCode: 0, stdout: ndjson(metadataRow()), stderr: new Uint8Array() }; } });
    for (let index = 0; index < 200; index += 1) exhausted.capacity.beginRequest().release();
    await expect(collectStackMetadata(exhausted)).rejects.toMatchObject({ code: "LIMIT_REJECTED" });
    expect(spawns).toBe(0);
  });

  it("requires the counters trailer and records requests, network bytes, and peak temporary disk", async () => {
    const options = await setup({
      runWorker: async () => ({ exitCode: 0, stdout: ndjson(metadataRow()), stderr: new Uint8Array() }),
    });

    const rows = await collectStackMetadata(options);

    expect(rows).toHaveLength(1);
    expect(options.capacity.snapshot()).toMatchObject({
      requestCount: 3, stackMetadataBytes: 4096, peakTemporaryDiskBytes: 1024, temporaryDiskBytes: 0,
    });
  });

  it("rejects a missing, malformed, over-budget, or inconsistent counters trailer before blobs", async () => {
    const row = metadataRow();
    const cases = [
      ["OUTPUT_MALFORMED", lines(row)],
      ["COUNTERS_REJECTED", lines(row, { counters: { requests: 1 } })],
      ["COUNTERS_REJECTED", lines(row, { counters: { requests: 3, redirectsFollowed: 0, peakTemporaryDiskBytes: 0, networkBytes: 1 } })],
      ["COUNTERS_REJECTED", lines(row, { counters: { ...counters().counters, extra: 1 } })],
      ["COUNTERS_REJECTED", lines(row, counters({ networkBytes: -1 }))],
      ["COUNTERS_REJECTED", lines(row, counters({ requests: 1.5 }))],
      ["COUNTERS_REJECTED", lines(row, counters({ redirectsFollowed: 4 }))],
      ["COUNTERS_REJECTED", lines(row, { trailer: counters().counters })],
      ["METADATA_CAPACITY", lines(row, counters({ requests: 201 }))],
      ["METADATA_BYTES", lines(row, counters({ networkBytes: 67_108_865 }))],
      ["TEMPORARY_DISK", lines(row, counters({ peakTemporaryDiskBytes: 33_554_433 }))],
    ] as const;
    for (const [code, stdout] of cases) {
      await expectBeforeBlob(code, { runWorker: async () => ({ exitCode: 0, stdout, stderr: new Uint8Array() }) });
    }
  });

  it("charges every inspected row, accepts fewer emitted rows, and rejects inspected counts off the ceiling", async () => {
    const options = await setup({
      rowLimit: 3,
      runWorker: async () => ({ exitCode: 0, stdout: lines(metadataRow(), counters({ rowsInspected: 3 })), stderr: new Uint8Array() }),
    });

    const rows = await collectStackMetadata(options);

    expect(rows).toHaveLength(1);
    expect(options.capacity.snapshot().stackRows.Python).toBe(3);
    for (const [code, inspected] of [["OUTPUT_MALFORMED", 2], ["ROW_OVERRUN", 4], ["ROW_OVERRUN", 0]] as const) {
      await expectBeforeBlob(code, {
        rowLimit: 3,
        runWorker: async () => ({ exitCode: 0, stdout: lines(metadataRow(), counters({ rowsInspected: inspected })), stderr: new Uint8Array() }),
      });
    }
    await expectBeforeBlob("COUNTERS_REJECTED", {
      runWorker: async () => ({ exitCode: 0, stdout: lines(metadataRow(), { counters: { networkBytes: 1, peakTemporaryDiskBytes: 0, redirectsFollowed: 0, requests: 1 } }), stderr: new Uint8Array() }),
    });
  });

  it("records exact rows and metadata bytes with the accepted capacity meter before blobs", async () => {
    const order: string[] = [];
    const options = await setup({
      runWorker: async () => {
        order.push("worker");
        return { exitCode: 0, stdout: ndjson(metadataRow()), stderr: new Uint8Array() };
      },
      blobAccess: async () => { order.push("blob"); },
    });
    await collectStackMetadata(options);
    expect(order).toEqual(["worker", "blob"]);
    expect(options.capacity.snapshot().stackRows.Python).toBe(1);
    expect(options.capacity.snapshot().stackMetadataBytes).toBe(4096);
  });

  it("rejects missing uv, a wrong lock, or a wrong Python pin before blobs", async () => {
    await expectBeforeBlob("UV_MISSING", {
      runWorker: async () => { throw Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" }); },
    });
    await expectBeforeBlob("LOCK_MISMATCH", {
      readRuntimeFile: async (path: URL) => path.href === lockPath.href
        ? Buffer.from("tampered lock")
        : readFile(path),
      runWorker: async () => { throw new Error("must not spawn"); },
    });
    await expectBeforeBlob("PYTHON_MISMATCH", {
      readRuntimeFile: async (path: URL) => path.href === pythonPath.href
        ? Buffer.from("3.11\n")
        : readFile(path),
      runWorker: async () => { throw new Error("must not spawn"); },
    });
    await expectBeforeBlob("RUNTIME_MISSING", {
      readRuntimeFile: async () => { throw new Error("missing runtime"); },
      runWorker: async () => { throw new Error("must not spawn"); },
    });
  });

  it("rejects unsupported configuration, limits, and blank environment before spawning", async () => {
    for (const [code, overrides] of [
      ["CONFIGURATION_REJECTED", { configuration: "JavaScript" }],
      ["LIMIT_REJECTED", { rowLimit: 0 }],
      ["LIMIT_REJECTED", { rowLimit: 10_001 }],
      ["ENVIRONMENT_REJECTED", { environment: { PATH: "/bin", HF_TOKEN: "   " } }],
      ["ENVIRONMENT_REJECTED", { environment: { PATH: "", HF_TOKEN: "external-token" } }],
    ] as const) {
      let spawns = 0;
      await expectBeforeBlob(code, {
        ...overrides,
        runWorker: async () => {
          spawns += 1;
          return { exitCode: 0, stdout: ndjson(metadataRow()), stderr: new Uint8Array() };
        },
      });
      expect(spawns).toBe(0);
    }
  });

  it("rejects malformed, unordered, duplicate, and overrun NDJSON before blobs", async () => {
    const unorderedRow = Object.fromEntries([
      ["path", "src/example.py"],
      ...Object.entries(metadataRow()).filter(([key]) => key !== "path"),
    ]);
    const malformed = [
      ["OUTPUT_MALFORMED", Buffer.from("not-json\n")],
      ["OUTPUT_MALFORMED", Buffer.from(JSON.stringify(metadataRow()))],
      ["ROW_SHAPE_REJECTED", ndjson({ ...metadataRow(), extra: true })],
      ["ROW_ORDER_REJECTED", ndjson(unorderedRow)],
      ["ROW_DUPLICATE", ndjson(metadataRow(), metadataRow())],
      ["ROW_OVERRUN", ndjson(metadataRow(), metadataRow({ stableRowId: "2".repeat(64) }))],
    ] as const;
    for (const [code, stdout] of malformed) {
      await expectBeforeBlob(code, {
        rowLimit: code === "ROW_DUPLICATE" ? 2 : 1,
        runWorker: async () => ({ exitCode: 0, stdout, stderr: new Uint8Array() }),
      });
    }
  });

  it("rejects invalid row values, nonzero exits, stderr, and byte overrun without disclosure", async () => {
    await expectBeforeBlob("ROW_VALUE_REJECTED", {
      runWorker: async () => ({
        exitCode: 0,
        stdout: ndjson(metadataRow({ sourceEncoding: "latin-1" })),
        stderr: new Uint8Array(),
      }),
    });
    await expectBeforeBlob("WORKER_EXIT", {
      runWorker: async () => ({
        exitCode: 1,
        stdout: new Uint8Array(),
        stderr: Buffer.from("Bearer sensitive-token account@example.test"),
      }),
    });
    await expectBeforeBlob("WORKER_STDERR", {
      runWorker: async () => ({
        exitCode: 0,
        stdout: ndjson(metadataRow()),
        stderr: Buffer.from("warning: secret=value"),
      }),
    });
    const error = await collectStackMetadata(await setup({
      runWorker: async () => { throw new Error("Bearer hidden-token"); },
    })).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe("WORKER_START_FAILED");
    expect(error.message).not.toMatch(/hidden|token|bearer/iu);
    await expectBeforeBlob("METADATA_BYTES", {
      runWorker: async () => ({
        exitCode: 0,
        stdout: new Uint8Array(67_108_865),
        stderr: new Uint8Array(),
      }),
    });
  });

  it("rejects every invalid projected identity and screened value", async () => {
    const invalidRows = [
      metadataRow({ stableRowId: "f".repeat(64) }),
      ...["swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId"]
        .map((key) => metadataRow({ [key]: "bad" })),
      metadataRow({ repository: "not-a-repository" }),
      metadataRow({ path: "/absolute/example.py" }),
      metadataRow({ path: "src/../example.py" }),
      metadataRow({ detectedLanguage: "TypeScript" }),
      metadataRow({ detectedLicenses: [] }),
      metadataRow({ detectedLicenses: ["MIT", "MIT"] }),
      metadataRow({ generated: true }),
      metadataRow({ vendor: true }),
      metadataRow({ sourceEncoding: "utf-8" }),
      metadataRow({ byteLength: 0 }),
      metadataRow({ byteLength: 262_145 }),
      metadataRow({ visitDate: "not-a-date" }),
      metadataRow({ revisionDate: "not-a-date" }),
      metadataRow({ committerDate: "not-a-date" }),
    ];
    for (const row of invalidRows) {
      await expect(collectStackMetadata(await setup({
        runWorker: async () => ({ exitCode: 0, stdout: ndjson(row), stderr: new Uint8Array() }),
      }))).rejects.toBeInstanceOf(Error);
    }
  });

  it("accepts exact TypeScript paths and preserves provider row order", async () => {
    const first = metadataRow({
      swhBlobId: "1".repeat(40),
      detectedLanguage: "TypeScript",
      path: "src/example.ts",
    });
    const second = metadataRow({
      swhBlobId: "2".repeat(40),
      detectedLanguage: "TypeScript",
      path: "src/example.tsx",
    });
    const rows = await collectStackMetadata(await setup({
      configuration: "TypeScript",
      rowLimit: 2,
      runWorker: async () => ({ exitCode: 0, stdout: lines(first, second, counters({ rowsInspected: 2 })), stderr: new Uint8Array() }),
    }));
    expect(rows.map(({ swhBlobId }: { swhBlobId: string }) => swhBlobId))
      .toEqual(["1".repeat(40), "2".repeat(40)]);
  });

  it("always invokes worker cleanup after success or rejection", async () => {
    for (const exitCode of [0, 1]) {
      let cleanups = 0;
      const operation = collectStackMetadata(await setup({
        runWorker: async () => ({
          exitCode,
          stdout: exitCode === 0 ? ndjson(metadataRow()) : new Uint8Array(),
          stderr: new Uint8Array(),
          cleanup: async () => { cleanups += 1; },
        }),
      }));
      if (exitCode === 0) await operation;
      else await expect(operation).rejects.toMatchObject({ code: "WORKER_EXIT" });
      expect(cleanups).toBe(1);
    }
  });

  it("invokes worker cleanup after every result-side rejection", async () => {
    for (const result of [
      { exitCode: 1, stdout: new Uint8Array(), stderr: new Uint8Array() },
      { exitCode: 0, stdout: ndjson(metadataRow()), stderr: Buffer.from("warning") },
      { exitCode: 0, stdout: Buffer.from("not-json\n"), stderr: new Uint8Array() },
      { exitCode: 0, stdout: new Uint8Array(67_108_865), stderr: new Uint8Array() },
    ]) {
      let cleanups = 0;
      await expect(collectStackMetadata(await setup({
        runWorker: async () => ({
          ...result,
          cleanup: async () => { cleanups += 1; },
        }),
      }))).rejects.toBeInstanceOf(Error);
      expect(cleanups).toBe(1);
    }
  });
});
