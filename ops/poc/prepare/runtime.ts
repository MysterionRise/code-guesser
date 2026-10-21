import { createHash } from "node:crypto";

import { canonicalBytes, canonicalHash } from "./canonical";
import type { CapacityMeter } from "./capacity";
import { decodeEntry, type ReplayPolicy, type RunJournal } from "./journal";
import type { CrawlProfile } from "./profile";
import type { RequestInput } from "./request-policy";
import { createRetryController, RetryError, RetryRequestError, RUN_RETRY_LIMIT, type RetryController } from "./retry";
import {
  codeError, createBoundedTransport, statusError, TransportError, type BoundedTransport, type RateLimitObservation, type TransportErrorCode,
} from "./transport";
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
  /** Throws `RUN_INTERRUPTED` once the run's signal has fired; every request checks it, and a worker run does too. */
  stopIfInterrupted(): void;
}

export interface RuntimeOptions {
  /** Fires on SIGINT or SIGTERM: the next request or worker run stops the run as `RUN_INTERRUPTED`. */
  readonly signal?: AbortSignal;
  /** The clock a rate limit's reset is read against, in epoch milliseconds. */
  readonly now?: () => number;
}

export class ReplayMissError extends Error {
  public readonly code = "FINALIZE_REPLAY_MISS";
  public constructor() { super("FINALIZE_REPLAY_MISS"); this.name = "ReplayMissError"; }
}

export class RunInterruptedError extends Error {
  public readonly code = "RUN_INTERRUPTED";
  public constructor() { super("RUN_INTERRUPTED"); this.name = "RunInterruptedError"; }
}

/**
 * A live GitHub request is held back when this many core requests or fewer are left and the window resets beyond
 * the wait ceiling (#165): the run stops at a checkpoint instead of spending the last requests on refusals.
 */
export const RATE_LIMIT_RESERVE = 25;
const CORE_RESOURCE = "core";

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
  options: RuntimeOptions = {},
): Runtime => {
  const now = options.now ?? Date.now;
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
  // What GitHub last said of each rate-limit resource. A response from an earlier window, or one sent before a
  // later answer in the same window, cannot raise what is left.
  const rateLimits = new Map<string, RateLimitObservation>();
  const observeRateLimit = (observation: RateLimitObservation): void => {
    const known = rateLimits.get(observation.resource);
    if (known === undefined || observation.resetAt > known.resetAt
      || (observation.resetAt === known.resetAt && observation.remaining < known.remaining)) rateLimits.set(observation.resource, observation);
  };
  /**
   * Holds back a live GitHub request near the end of the core limit (#165). Search pages draw on their own
   * per-minute limit, which resets within a retry's wait or stops the run through the retry controller.
   */
  const holdBack = (input: RequestInput): void => {
    if (input.provider !== "github" || new URL(input.url).pathname === SEARCH_PATH) return;
    const core = rateLimits.get(CORE_RESOURCE);
    if (core !== undefined && core.remaining <= RATE_LIMIT_RESERVE && core.resetAt - now() > profile.capacity.waitMilliseconds) {
      throw new RetryError("RATE_LIMIT_CHECKPOINT", undefined, core.resetAt);
    }
  };
  const base = createBoundedTransport({ fetch: fetchLike, credentials, now, observeRateLimit, limits: {
    timeoutMilliseconds: profile.capacity.waitMilliseconds, concurrentRequests: profile.capacity.concurrentRequests,
    requestCount: profile.capacity.requestCount, responseBytes: profile.capacity.responseBytes, pages: profile.capacity.githubPages,
  } });
  const runtime: Runtime = {
    capacity, retry, environment, responses: new Map(), hashes: [], replay: false,
    ...(journal ? { journal } : {}),
    transport: undefined as unknown as BoundedTransport,
    beginReplay: () => { runtime.replay = true; },
    stopIfInterrupted: () => { if (options.signal?.aborted) throw new RunInterruptedError(); },
  };
  const request = async (kind: "json" | "bytes", input: RequestInput, page?: number): Promise<unknown> => {
    runtime.stopIfInterrupted();
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
    if (!recorded) holdBack(input);
    const lease = capacity.beginRequest();
    try {
      if (recorded?.encoding === "failure") {
        const failure = recorded.body as { status?: number; code?: string };
        throw failure.status !== undefined ? statusError(input, failure.status) : codeError(input, failure.code as TransportErrorCode);
      }
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
      // A retryable failure (a timeout, a 5xx) is recorded as what it wrapped; an offline replay fails at once
      // instead of waiting to retry, and rejects the same candidate the live run rejected.
      // A rate limit is not recorded: a run that cannot retry it stops at a checkpoint (#165), so an offline replay
      // stops at the same request with `JOURNAL_MISS`, and the run that resumes it asks again. A malformed
      // rate-limit instruction has no failure of its own; it is recorded as a 429, rejecting the same candidate.
      const rateLimited = error instanceof RetryRequestError && error.rateLimit !== undefined;
      const failure = error instanceof RetryRequestError
        ? error.cause instanceof TransportError ? error.cause : error.cause === undefined ? statusError(input, 429) : error
        : error;
      if (!recorded && !rateLimited && failure instanceof TransportError && policy !== "sequence") {
        // A deterministic answer (missing, gone) replays on resume too. Any other failure, such as a timeout
        // or a refused request, replays only offline: a resumed run retries it, an offline one reproduces it.
        const deterministic = deterministicStatus(input, failure) !== undefined;
        const body = failure.status !== undefined ? { status: failure.status } : { code: failure.code };
        journal?.record({ key, policy: deterministic ? policy : "offline", sha256: sha256(canonicalBytes(body)), byteLength: 0,
          encoding: "failure", body });
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
