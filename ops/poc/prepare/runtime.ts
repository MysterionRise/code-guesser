import { createHash } from "node:crypto";

import { canonicalBytes, canonicalHash } from "./canonical";
import type { CapacityMeter } from "./capacity";
import { PreparationError } from "./diagnostics";
import type { CrawlProfile } from "./profile";
import type { RequestInput } from "./request-policy";
import { createRetryController, RUN_RETRY_LIMIT, type RetryController } from "./retry";
import { createBoundedTransport, type BoundedTransport } from "./transport";
import type { Context, Environment, StageResult } from "./types";

export interface Runtime {
  readonly capacity: CapacityMeter;
  transport: BoundedTransport;
  readonly retry: RetryController;
  readonly environment: Environment;
  readonly responses: Map<string, unknown[]>;
  readonly hashes: string[];
  readonly replayCursors: Map<string, number>;
  replay: boolean;
  beginReplay(): void;
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

export const createPreparationRuntime = (
  profile: CrawlProfile,
  environment: Environment,
  capacity: CapacityMeter,
  fetchLike: typeof fetch = fetch,
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
    capacity, retry, environment, responses: new Map(), hashes: [], replayCursors: new Map(), replay: false,
    transport: undefined as unknown as BoundedTransport,
    beginReplay: () => { runtime.replay = true; runtime.replayCursors.clear(); },
  };
  const request = async (kind: "json" | "bytes", input: RequestInput, page?: number): Promise<unknown> => {
    const key = responseKey(input);
    const cached = runtime.responses.get(key) ?? [];
    if (runtime.replay) {
      const offset = runtime.replayCursors.get(key) ?? 0;
      const value = reusable(input) ? cached[0] : cached[offset];
      if (value === undefined) throw new PreparationError();
      runtime.replayCursors.set(key, offset + 1);
      return structuredClone(value);
    }
    if (reusable(input) && cached.length > 0) return structuredClone(cached[0]);
    const lease = capacity.beginRequest();
    try {
      const value = kind === "json" ? await base.requestJson(input, page) : await base.requestBytes(input, page);
      const bytes = kind === "json" ? canonicalBytes(value) : value as Uint8Array;
      lease.complete(bytes.byteLength);
      runtime.hashes.push(createHash("sha256").update(bytes).digest("hex"));
      runtime.responses.set(key, [...cached, structuredClone(value)]);
      if (kind === "json" && new URL(input.url).pathname === SEARCH_PATH) {
        const query = profile.github.queries.find(({ query: value }) => value === new URL(input.url).searchParams.get("q"));
        const body = value as Record<string, unknown>;
        capacity.recordGitHubPage(query?.id ?? "", Array.isArray(body.items) ? body.items.length : 0);
      }
      return value;
    } catch (error) { lease.release(); throw error; }
  };
  runtime.transport = Object.freeze({
    requestJson: (input: RequestInput, page?: number) => request("json", input, page),
    requestBytes: (input: RequestInput, page?: number) => request("bytes", input, page) as Promise<Uint8Array>,
  });
  return runtime;
};
