import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CapacityMeter } from "./capacity";
import {
  parseWorkerCounters,
  runLockedWorker,
  splitWorkerOutput,
  type StackMetadataRow,
  type WorkerCounters,
  type WorkerRequest,
  type WorkerResult,
} from "./stack-metadata";
import type { SelectedStackBlob } from "./stack-revalidation";
import { SIGNED_CAPACITY_CEILINGS } from "./profile";

const RUNTIME_DIRECTORY = fileURLToPath(new URL("../stack/", import.meta.url)).replace(/\/$/u, "");
const WORKER_PATH = join(RUNTIME_DIRECTORY, "fetch_blob.py");
const STDERR_LIMIT = 4096;
const STDOUT_EXPANSION = 2;
const BLOB_KEYS = ["stableRowId", "swhBlobId", "contentBase64", "byteLength"] as const;
const ROW_INPUT_KEYS = ["stableRowId", "swhBlobId", "swhContentId", "sourceEncoding", "byteLength"] as const;
const WORKER_ENVIRONMENT_KEYS = [
  "PATH", "HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "AWS_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE",
] as const;
const LIMIT_CEILINGS = Object.freeze({
  blobAttempts: SIGNED_CAPACITY_CEILINGS.blobAttempts,
  successfulBlobs: SIGNED_CAPACITY_CEILINGS.successfulBlobs,
  perBlobBytes: SIGNED_CAPACITY_CEILINGS.perBlobBytes,
  totalBlobBytes: SIGNED_CAPACITY_CEILINGS.totalBlobBytes,
  temporaryDiskBytes: SIGNED_CAPACITY_CEILINGS.temporaryDiskBytes,
  requestLimit: SIGNED_CAPACITY_CEILINGS.requestCount,
  networkByteLimit: SIGNED_CAPACITY_CEILINGS.perBlobBytes,
});

export class BlobWorkerError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "BlobWorkerError";
  }
}

/** Remaining ceilings handed to one selected-blob worker invocation; every value is positive and at most the signed ceiling. */
export interface BlobWorkerLimits {
  readonly blobAttempts: number;
  readonly successfulBlobs: number;
  readonly perBlobBytes: number;
  readonly totalBlobBytes: number;
  readonly temporaryDiskBytes: number;
  readonly requestLimit: number;
  readonly networkByteLimit: number;
}

export interface ParsedBlobOutput {
  readonly blob: SelectedStackBlob;
  readonly counters: WorkerCounters;
}

export interface FetchSelectedBlobOptions {
  readonly row: StackMetadataRow;
  readonly limits: BlobWorkerLimits;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly capacity: Pick<CapacityMeter, "recordWorkerRequests">;
  readonly runWorker?: (request: WorkerRequest) => Promise<WorkerResult>;
}

type Environment = Readonly<Record<string, string | undefined>>;

const fail = (code: string): never => { throw new BlobWorkerError(code); };

export const projectBlobWorkerEnvironment = (source: Environment): Environment => Object.freeze(Object.fromEntries(
  WORKER_ENVIRONMENT_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
));

const validateLimits = (limits: BlobWorkerLimits): void => {
  const keys = Object.keys(LIMIT_CEILINGS) as (keyof BlobWorkerLimits)[];
  if (Object.keys(limits).sort().join("|") !== [...keys].sort().join("|")) fail("LIMIT_REJECTED");
  for (const key of keys) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > LIMIT_CEILINGS[key]) fail("LIMIT_REJECTED");
  }
};

export const blobWorkerRequest = (
  row: StackMetadataRow,
  limits: BlobWorkerLimits,
  environment: Environment,
): WorkerRequest => {
  validateLimits(limits);
  const projected = projectBlobWorkerEnvironment(environment) as Record<string, string>;
  if (!projected.PATH || projected.PATH.trim().length === 0) fail("ENVIRONMENT_REJECTED");
  const inputRow = Object.fromEntries(ROW_INPUT_KEYS.map((key) => [key, row[key]]));
  return Object.freeze({
    command: "uv",
    args: Object.freeze(["run", "--project", RUNTIME_DIRECTORY, "--locked", "python", WORKER_PATH]),
    cwd: RUNTIME_DIRECTORY,
    environment: Object.freeze(projected),
    stdin: `${JSON.stringify({ rows: [inputRow], limits })}\n`,
    stdoutByteLimit: limits.perBlobBytes * STDOUT_EXPANSION,
    stderrByteLimit: STDERR_LIMIT,
  });
};

const parseBlobLine = (line: string, row: StackMetadataRow): SelectedStackBlob => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return fail("OUTPUT_MALFORMED");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail("OUTPUT_MALFORMED");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join("|") !== [...BLOB_KEYS].sort().join("|")) fail("BLOB_IDENTITY_REJECTED");
  if (record.stableRowId !== row.stableRowId || record.swhBlobId !== row.swhBlobId
    || record.byteLength !== row.byteLength || typeof record.contentBase64 !== "string") {
    fail("BLOB_IDENTITY_REJECTED");
  }
  return Object.freeze({
    stableRowId: record.stableRowId as string,
    swhBlobId: record.swhBlobId as string,
    contentBase64: record.contentBase64 as string,
    byteLength: record.byteLength as number,
  });
};

export const parseBlobWorkerOutput = (
  result: WorkerResult,
  row: StackMetadataRow,
  limits: BlobWorkerLimits,
): ParsedBlobOutput => {
  if (result.stdout.byteLength > limits.perBlobBytes * STDOUT_EXPANSION) fail("NETWORK_BYTES");
  if (result.stderr.byteLength > STDERR_LIMIT) fail("WORKER_STDERR");
  if (result.exitCode !== 0) fail("WORKER_EXIT");
  if (result.stderr.byteLength !== 0) fail("WORKER_STDERR");
  const { lines, trailer } = splitWorkerOutput(result.stdout);
  if (lines.length !== 1) fail("OUTPUT_MALFORMED");
  const blob = parseBlobLine(lines[0]!, row);
  const counters = parseWorkerCounters(trailer);
  if (counters.peakTemporaryDiskBytes !== 0) fail("TEMPORARY_DISK");
  if (counters.redirectsFollowed !== 0) fail("REDIRECT_REJECTED");
  if (counters.requests > limits.requestLimit) fail("BLOB_CAPACITY");
  if (counters.networkBytes > limits.networkByteLimit) fail("NETWORK_BYTES");
  return Object.freeze({ blob, counters });
};

export const fetchSelectedBlob = async (options: FetchSelectedBlobOptions): Promise<SelectedStackBlob> => {
  const request = blobWorkerRequest(options.row, options.limits, options.environment);
  let result: WorkerResult;
  try {
    result = await (options.runWorker ?? runLockedWorker)(request);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("UV_MISSING");
    return fail("WORKER_START_FAILED");
  }
  try {
    const parsed = parseBlobWorkerOutput(result, options.row, options.limits);
    try {
      options.capacity.recordWorkerRequests(parsed.counters.requests);
    } catch {
      return fail("BLOB_CAPACITY");
    }
    return parsed.blob;
  } finally {
    await result.cleanup?.();
  }
};
