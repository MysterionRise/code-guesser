import { createHash } from "node:crypto";

import { canonicalBytes, canonicalHash } from "./canonical";
import type { CapacityMeter } from "./capacity";
import { decodeEntry, type ReplayPolicy, type RunJournal } from "./journal";
import type { CrawlProfile } from "./profile";
import type { RequestInput } from "./request-policy";
import { createRetryController, RUN_RETRY_LIMIT, type RetryController } from "./retry";
import { createBoundedTransport, statusError, TransportError, type BoundedTransport } from "./transport";
import type { Context, Environment, StageResult } from "./types";

export interface Runtime {
  readonly capacity: CapacityMeter;
  transport: BoundedTransport;
  readonly retry: RetryController;
  readonly environment: Environment;
  readonly responses: Map<string, unknown>;
  readonly hashes: string[];
  readonly journal?: RunJournal;
  replay: boolean;
  /** From now on every request must be one this run already accepted; finalization rebinds sources without new requests. */
  beginReplay(): void;
}

export class ReplayMissError extends Error {
  public readonly code = "FINALIZE_REPLAY_MISS";
  public constructor() { super("FINALIZE_REPLAY_MISS"); this.name = "ReplayMissError"; }
}

export const runtimeOf = (context: Context): Runtime => context.runtime as Runtime;

/** Runs one network stage and reports the hashes of the responses it accepted. */
export const stage = async <Value>(runtime: Runtime, operation: () => Promise<Value>): Promise<StageResult<Value>> => {
  const offset = runtime.hashes.length;
  const value = await operation();
  return Object.freeze({ value, acceptedResponseHashes: Object.freeze(runtime.hashes.slice(offset)) });
};

/** A Python worker stage is accepted by the hash of its validated output. */
export const workerStage = async <Value>(operation: () => Promise<Value>): Promise<StageResult<Value>> => {
  const value = await operation();
  return Object.freeze({ value, acceptedResponseHashes: Object.freeze([canonicalHash(value)]) });
};

const responseKey = (request: { provider: string; method: string; url: string }): string =>
  `${request.provider}\0${request.method}\0${request.url}`;
const SEARCH_PATH = "/search/commits";
/** Identical GitHub GETs within one run reuse the first response; search pages stay fresh so a re-crawl sees new data. */
const reusable = (request: RequestInput): boolean =>
  request.provider === "github" && request.method === "GET" && new URL(request.url).pathname !== SEARCH_PATH;
/** Repository, commit, tree, blob, and licence GETs are deterministic; search pages are ordered; the access check is always live. */
const replayPolicy = (request: RequestInput): ReplayPolicy =>
  reusable(request) ? "fixed" : request.provider === "github" && new URL(request.url).pathname === SEARCH_PATH ? "sequence" : "offline";
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
/** Answers that say what the provider holds (missing, gone, unprocessable), not how it is doing; rate limits are excluded. */
const DETERMINISTIC_STATUSES = new Set([404, 409, 410, 422, 451]);
const deterministicStatus = (request: RequestInput, error: unknown): number | undefined =>
  reusable(request) && error instanceof TransportError && error.code === "UNSUPPORTED_STATUS"
    && error.status !== undefined && DETERMINISTIC_STATUSES.has(error.status) ? error.status : undefined;

export const createPreparationRuntime = (
  profile: CrawlProfile,
  environment: Environment,
  capacity: CapacityMeter,
  fetchLike: typeof fetch = fetch,
  journal?: RunJournal,
): Runtime => {
  const retry = createRetryController({
    maxRunRetries: RUN_RETRY_LIMIT,
    maxWaitMilliseconds: profile.capacity.waitMilliseconds,
    maxTotalWaitMilliseconds: profile.capacity.totalWaitMilliseconds,
    sleep: async (milliseconds) => { capacity.recordRetryWait(milliseconds); await new Promise((done) => setTimeout(done, milliseconds)); },
  });
  const credentials = {
    ...(environment.GITHUB_TOKEN ? { github: `Bearer ${environment.GITHUB_TOKEN}` } : {}),
    ...(environment.HF_TOKEN ? { huggingFace: `Bearer ${environment.HF_TOKEN}` } : {}),
  };
  const base = createBoundedTransport({ fetch: fetchLike, credentials, limits: {
    timeoutMilliseconds: profile.capacity.waitMilliseconds, concurrentRequests: profile.capacity.concurrentRequests,
    requestCount: profile.capacity.requestCount, responseBytes: profile.capacity.responseBytes, pages: profile.capacity.githubPages,
  } });
  const runtime: Runtime = {
    capacity, retry, environment, responses: new Map(), hashes: [], replay: false,
    ...(journal ? { journal } : {}),
    transport: undefined as unknown as BoundedTransport,
    beginReplay: () => { runtime.replay = true; },
  };
  const request = async (kind: "json" | "bytes", input: RequestInput, page?: number): Promise<unknown> => {
    const key = responseKey(input);
    const cached = runtime.responses.get(key);
    if (runtime.replay) {
      if (!reusable(input) || cached === undefined) throw new ReplayMissError();
      return structuredClone(cached);
    }
    if (reusable(input) && cached !== undefined) return structuredClone(cached);
    const policy = replayPolicy(input);
    // A journal replay is metered like a live response, so a replayed run spends what a live one would.
    const recorded = journal?.take(key, policy);
    const lease = capacity.beginRequest();
    try {
      if (recorded?.encoding === "failure") throw statusError(input, (recorded.body as { status: number }).status);
      let value: unknown;
      let accepted: string;
      let byteLength: number;
      if (recorded) {
        value = decodeEntry(recorded);
        accepted = recorded.sha256;
        byteLength = recorded.byteLength;
      } else {
        value = kind === "json" ? await base.requestJson(input, page) : await base.requestBytes(input, page);
        const bytes = kind === "json" ? canonicalBytes(value) : value as Uint8Array;
        accepted = sha256(bytes);
        byteLength = bytes.byteLength;
      }
      lease.complete(byteLength);
      if (!recorded) {
        journal?.record({ key, policy, sha256: accepted, byteLength, encoding: kind === "json" ? "json" : "base64",
          body: kind === "json" ? value : Buffer.from(value as Uint8Array).toString("base64") });
      }
      runtime.hashes.push(accepted);
      if (reusable(input)) runtime.responses.set(key, structuredClone(value));
      if (kind === "json" && new URL(input.url).pathname === SEARCH_PATH) {
        const query = profile.github.queries.find(({ query: text }) => text === new URL(input.url).searchParams.get("q"));
        const body = value as Record<string, unknown>;
        capacity.recordGitHubPage(query?.id ?? "", Array.isArray(body.items) ? body.items.length : 0);
      }
      return value;
    } catch (error) {
      lease.release();
      const status = recorded ? undefined : deterministicStatus(input, error);
      if (status !== undefined) {
        const body = { status };
        journal?.record({ key, policy, sha256: sha256(canonicalBytes(body)), byteLength: 0, encoding: "failure", body });
      }
      throw error;
    }
  };
  runtime.transport = Object.freeze({
    requestJson: (input: RequestInput, page?: number) => request("json", input, page),
    requestBytes: (input: RequestInput, page?: number) => request("bytes", input, page) as Promise<Uint8Array>,
  });
  return runtime;
};
