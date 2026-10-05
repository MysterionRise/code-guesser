import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CapacityMeter } from "./capacity";
import type { CrawlProfile } from "./profile";

const RUNTIME_DIRECTORY = fileURLToPath(new URL("../stack/", import.meta.url)).replace(/\/$/u, "");
const WORKER_PATH = join(RUNTIME_DIRECTORY, "stream_metadata.py");
const LOCK_PATH = new URL("../stack/uv.lock", import.meta.url);
const PYTHON_PATH = new URL("../stack/.python-version", import.meta.url);
const LOCK_HASH = "c58acb21cc4a0dd5bf97d088a35c8343a0c3ffd2da7150f30a195fa9836b3e07";
const STDERR_LIMIT = 4096;
const REVISION = "e565caa3a78c2423bd374333a472b049eb090e47";
const ROW_KEYS = [
  "stableRowId", "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId",
  "swhRevisionId", "repository", "path", "detectedLicenses", "detectedLanguage",
  "generated", "vendor", "sourceEncoding", "byteLength", "visitDate", "revisionDate",
  "committerDate",
] as const;
const COUNTER_KEYS = ["networkBytes", "peakTemporaryDiskBytes", "redirectsFollowed", "requests"] as const;
const HEX_40 = /^[0-9a-f]{40}$/u;
const HEX_64 = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const UTC_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{6})?Z$/u;

export class StackMetadataError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "StackMetadataError";
  }
}

export interface StackMetadataRow extends Readonly<Record<string, unknown>> {
  readonly stableRowId: string;
  readonly swhBlobId: string;
  readonly swhContentId: string;
  readonly swhDirectoryId: string;
  readonly swhSnapshotId: string;
  readonly swhRevisionId: string;
  readonly repository: string;
  readonly path: string;
  readonly detectedLicenses: readonly string[];
  readonly detectedLanguage: "Python" | "TypeScript";
  readonly generated: false;
  readonly vendor: false;
  readonly sourceEncoding: "UTF-8";
  readonly byteLength: number;
  readonly visitDate: string;
  readonly revisionDate: string;
  readonly committerDate: string;
}

export interface WorkerRequest {
  readonly command: "uv";
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly stdoutByteLimit: number;
  readonly stderrByteLimit: number;
}

/** Bounded counts a locked worker reports on its final stdout line so Node can meter them. */
export interface WorkerCounters {
  readonly networkBytes: number;
  readonly peakTemporaryDiskBytes: number;
  readonly redirectsFollowed: number;
  readonly requests: number;
}

export interface WorkerResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly cleanup?: () => Promise<void>;
}

export interface StackMetadataOptions {
  readonly profile: CrawlProfile;
  readonly capacity: Pick<CapacityMeter, "recordStackRows" | "recordWorkerRequests" | "reserveTemporaryDisk" | "snapshot">;
  readonly configuration: "Python" | "TypeScript";
  readonly rowLimit: number;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly runWorker?: (request: WorkerRequest) => Promise<WorkerResult>;
  readonly readRuntimeFile?: (path: URL) => Promise<Uint8Array>;
  readonly blobAccess: () => Promise<void>;
}

const fail = (code: string): never => { throw new StackMetadataError(code); };

export const runLockedWorker = (request: WorkerRequest): Promise<WorkerResult> => new Promise((resolve, reject) => {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.environment,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let exceeded = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > request.stdoutByteLimit) {
      exceeded = true;
      child.kill();
    } else stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > request.stderrByteLimit) {
      exceeded = true;
      child.kill();
    } else stderr.push(chunk);
  });
  child.once("error", reject);
  child.once("close", (exitCode) => resolve({
    exitCode: exceeded ? -1 : exitCode ?? -1,
    stdout: exceeded ? new Uint8Array(request.stdoutByteLimit + 1) : Buffer.concat(stdout),
    stderr: exceeded ? new Uint8Array(request.stderrByteLimit + 1) : Buffer.concat(stderr),
    cleanup: async () => { if (!child.killed) child.kill(); },
  }));
  child.stdin.end(request.stdin);
});

const validateRuntime = async (
  readRuntimeFile: (path: URL) => Promise<Uint8Array>,
): Promise<void> => {
  let python: Uint8Array;
  let lock: Uint8Array;
  try {
    [python, lock] = await Promise.all([readRuntimeFile(PYTHON_PATH), readRuntimeFile(LOCK_PATH)]);
  } catch {
    return fail("RUNTIME_MISSING");
  }
  if (new TextDecoder().decode(python).trim() !== "3.12") fail("PYTHON_MISMATCH");
  if (createHash("sha256").update(lock).digest("hex") !== LOCK_HASH) fail("LOCK_MISMATCH");
};

const workerRequest = (options: StackMetadataOptions): WorkerRequest => {
  if (options.configuration !== "Python" && options.configuration !== "TypeScript") {
    fail("CONFIGURATION_REJECTED");
  }
  const path = options.environment.PATH ?? fail("ENVIRONMENT_REJECTED");
  const token = options.environment.HF_TOKEN ?? fail("ENVIRONMENT_REJECTED");
  if (path.trim().length === 0 || token.trim().length === 0) fail("ENVIRONMENT_REJECTED");
  const snapshot = options.capacity.snapshot();
  const remaining = options.profile.capacity.stackMetadataBytes - snapshot.stackMetadataBytes;
  const requestLimit = options.profile.capacity.requestCount - snapshot.requestCount;
  const temporaryDiskBytes = options.profile.capacity.temporaryDiskBytes - snapshot.temporaryDiskBytes;
  if (!Number.isSafeInteger(options.rowLimit) || options.rowLimit < 1
    || options.rowLimit > options.profile.capacity.stackRowsPerLanguage || remaining < 1
    || requestLimit < 1 || temporaryDiskBytes < 1) {
    fail("LIMIT_REJECTED");
  }
  return Object.freeze({
    command: "uv",
    args: Object.freeze([
      "run", "--project", RUNTIME_DIRECTORY, "--locked", "python", WORKER_PATH,
    ]),
    cwd: RUNTIME_DIRECTORY,
    environment: Object.freeze({ PATH: path, HF_TOKEN: token }),
    stdin: `${JSON.stringify({
      configuration: options.configuration,
      revision: REVISION,
      rowLimit: options.rowLimit,
      perBlobByteLimit: options.profile.capacity.perBlobBytes,
      requestLimit,
      networkByteLimit: remaining,
      temporaryDiskBytes,
    })}\n`,
    stdoutByteLimit: remaining,
    stderrByteLimit: STDERR_LIMIT,
  });
};

const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Parses the canonical trailer line `{"counters":{...}}`; any shape, order, sign, or consistency drift rejects. */
export const parseWorkerCounters = (line: string): WorkerCounters => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return fail("COUNTERS_REJECTED");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail("COUNTERS_REJECTED");
  const outer = parsed as Record<string, unknown>;
  if (Object.keys(outer).join("|") !== "counters") fail("COUNTERS_REJECTED");
  const counters = outer.counters;
  if (typeof counters !== "object" || counters === null || Array.isArray(counters)) return fail("COUNTERS_REJECTED");
  const record = counters as Record<string, unknown>;
  if (Object.keys(record).join("|") !== COUNTER_KEYS.join("|")) fail("COUNTERS_REJECTED");
  if (COUNTER_KEYS.some((key) => !nonNegativeInteger(record[key]))) fail("COUNTERS_REJECTED");
  const result = Object.freeze({
    networkBytes: record.networkBytes as number,
    peakTemporaryDiskBytes: record.peakTemporaryDiskBytes as number,
    redirectsFollowed: record.redirectsFollowed as number,
    requests: record.requests as number,
  });
  if (result.redirectsFollowed > result.requests) fail("COUNTERS_REJECTED");
  if (line !== JSON.stringify({ counters: result })) fail("COUNTERS_REJECTED");
  return result;
};

/** Splits decoded worker stdout into its payload lines and the mandatory counters trailer. */
export const splitWorkerOutput = (bytes: Uint8Array): Readonly<{ lines: readonly string[]; trailer: string }> => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("OUTPUT_MALFORMED");
  }
  if (!text.endsWith("\n") || text.includes("\r")) fail("OUTPUT_MALFORMED");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length < 2 || lines.some((line) => line.length === 0)) fail("OUTPUT_MALFORMED");
  return Object.freeze({ lines: Object.freeze(lines.slice(0, -1)), trailer: lines.at(-1)! });
};

const exactRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("ROW_SHAPE_REJECTED");
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row);
  const sorted = [...actual].sort();
  if (sorted.join("|") !== [...ROW_KEYS].sort().join("|")) fail("ROW_SHAPE_REJECTED");
  if (actual.join("|") !== ROW_KEYS.join("|")) fail("ROW_ORDER_REJECTED");
  return row;
};

const validText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

const validPath = (value: unknown, language: "Python" | "TypeScript"): boolean => {
  if (!validText(value) || value.startsWith("/") || value.includes("\\")) return false;
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return language === "Python" ? value.endsWith(".py") : /\.tsx?$/u.test(value);
};

const validUtcDate = (value: unknown): value is string => {
  if (!validText(value)) return false;
  const match = UTC_DATE.exec(value);
  if (!match) return false;
  const instant = new Date(value);
  const expected = match.slice(1, 7).map(Number);
  const observed = [instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate(),
    instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds()];
  return !Number.isNaN(instant.valueOf()) && expected.every((part, index) => observed[index] === part);
};

const validateIdentity = (
  row: Record<string, unknown>,
  language: "Python" | "TypeScript",
): void => {
  const identities = [
    row.swhBlobId, row.swhContentId, row.swhDirectoryId, row.swhSnapshotId, row.swhRevisionId,
  ];
  if (!HEX_64.test(String(row.stableRowId))
    || identities.some((identity) => !HEX_40.test(String(identity)))
    || !validText(row.repository) || !REPOSITORY.test(row.repository)
    || !validPath(row.path, language)) fail("ROW_IDENTITY_REJECTED");
  const projected = Object.fromEntries(Object.keys(row).filter((key) => key !== "stableRowId")
    .sort().map((key) => [key, row[key]]));
  const expected = createHash("sha256").update(JSON.stringify(projected)).digest("hex");
  if (row.stableRowId !== expected) fail("ROW_IDENTITY_REJECTED");
};

const validateDates = (row: Record<string, unknown>): void => {
  for (const key of ["visitDate", "revisionDate", "committerDate"] as const) {
    if (!validUtcDate(row[key])) fail("ROW_DATE_REJECTED");
  }
};

const validateRow = (
  value: unknown,
  language: "Python" | "TypeScript",
  byteLimit: number,
): StackMetadataRow => {
  const row = exactRecord(value);
  const licenses = row.detectedLicenses;
  validateIdentity(row, language);
  validateDates(row);
  if (row.detectedLanguage !== language || !Array.isArray(licenses) || licenses.length === 0
    || licenses.some((license) => !validText(license)) || new Set(licenses).size !== licenses.length
    || row.generated !== false || row.vendor !== false || row.sourceEncoding !== "UTF-8"
    || !Number.isSafeInteger(row.byteLength) || (row.byteLength as number) < 1
    || (row.byteLength as number) > byteLimit) {
    fail("ROW_VALUE_REJECTED");
  }
  return Object.freeze({
    ...row,
    detectedLicenses: Object.freeze([...(licenses as string[])]),
  }) as StackMetadataRow;
};

interface ParsedMetadataOutput {
  readonly rows: readonly StackMetadataRow[];
  readonly counters: WorkerCounters;
}

const parseOutput = (bytes: Uint8Array, options: StackMetadataOptions): ParsedMetadataOutput => {
  if (bytes.byteLength > options.profile.capacity.stackMetadataBytes) fail("METADATA_BYTES");
  const { lines, trailer } = splitWorkerOutput(bytes);
  if (lines.length > options.rowLimit) fail("ROW_OVERRUN");
  if (lines.length !== options.rowLimit) fail("OUTPUT_MALFORMED");
  const rows = lines.map((line) => {
    try {
      const row = validateRow(JSON.parse(line), options.configuration, options.profile.capacity.perBlobBytes);
      if (line !== JSON.stringify(row)) fail("OUTPUT_NONCANONICAL");
      return row;
    } catch (error) {
      if (error instanceof StackMetadataError) throw error;
      return fail("OUTPUT_MALFORMED");
    }
  });
  const ids = rows.map(({ stableRowId }) => stableRowId);
  if (new Set(ids).size !== ids.length) fail("ROW_DUPLICATE");
  return Object.freeze({ rows: Object.freeze(rows), counters: parseWorkerCounters(trailer) });
};

const meterWorkerCounters = (
  options: StackMetadataOptions,
  request: WorkerRequest,
  parsed: ParsedMetadataOutput,
): void => {
  const budget = JSON.parse(request.stdin) as Record<string, number>;
  const { counters } = parsed;
  if (counters.requests > budget.requestLimit!) fail("METADATA_CAPACITY");
  if (counters.networkBytes > budget.networkByteLimit!) fail("METADATA_BYTES");
  if (counters.peakTemporaryDiskBytes > budget.temporaryDiskBytes!) fail("TEMPORARY_DISK");
  try {
    options.capacity.recordWorkerRequests(counters.requests);
    options.capacity.recordStackRows(options.configuration, parsed.rows.length, counters.networkBytes);
  } catch {
    return fail("METADATA_CAPACITY");
  }
  if (counters.peakTemporaryDiskBytes > 0) {
    try {
      options.capacity.reserveTemporaryDisk(counters.peakTemporaryDiskBytes)();
    } catch {
      return fail("TEMPORARY_DISK");
    }
  }
};

export const collectStackMetadata = async (
  options: StackMetadataOptions,
): Promise<readonly StackMetadataRow[]> => {
  await validateRuntime(options.readRuntimeFile ?? readFile);
  const request = workerRequest(options);
  let result: WorkerResult;
  try {
    result = await (options.runWorker ?? runLockedWorker)(request);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("UV_MISSING");
    return fail("WORKER_START_FAILED");
  }
  try {
    if (result.stdout.byteLength > request.stdoutByteLimit) fail("METADATA_BYTES");
    if (result.stderr.byteLength > request.stderrByteLimit) fail("WORKER_STDERR");
    if (result.exitCode !== 0) fail("WORKER_EXIT");
    if (result.stderr.byteLength !== 0) fail("WORKER_STDERR");
    const parsed = parseOutput(result.stdout, options);
    meterWorkerCounters(options, request, parsed);
    await options.blobAccess();
    return parsed.rows;
  } finally {
    await result.cleanup?.();
  }
};
