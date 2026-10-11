import { readFileSync } from "node:fs";

/**
 * The one limits file the preparer and the Python workers both read (`ops/poc/limits.json`): the pinned
 * Stack v2 dataset identity and the hard ceilings no crawl profile may exceed. Raise a ceiling here, and
 * the profile and both workers see the same value.
 */
const CEILING_KEYS = [
  "githubPages", "githubResults", "stackRowsPerLanguage", "stackMetadataBytes", "blobAttempts", "successfulBlobs",
  "perBlobBytes", "totalBlobBytes", "concurrentRequests", "requestCount", "responseBytes", "waitMilliseconds",
  "totalWaitMilliseconds", "temporaryDiskBytes",
] as const;
export type CeilingKey = typeof CEILING_KEYS[number];

const reject = (): never => { throw new Error("LIMITS_FILE_REJECTED"); };
const exactRecord = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject();
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) reject();
  return value as Record<string, unknown>;
};

export const parseLimits = (value: unknown) => {
  const root = exactRecord(value, ["stack", "ceilings"]);
  const stack = exactRecord(root.stack, ["dataset", "release", "revision"]);
  if (typeof stack.dataset !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(stack.dataset)
    || typeof stack.release !== "string" || stack.release.length === 0
    || typeof stack.revision !== "string" || !/^[0-9a-f]{40}$/u.test(stack.revision)) reject();
  const ceilings = exactRecord(root.ceilings, CEILING_KEYS);
  for (const key of CEILING_KEYS) {
    if (!Number.isSafeInteger(ceilings[key]) || (ceilings[key] as number) < 1) reject();
  }
  return Object.freeze({
    stack: Object.freeze({ dataset: stack.dataset as string, release: stack.release as string, revision: stack.revision as string }),
    ceilings: Object.freeze(Object.fromEntries(CEILING_KEYS.map((key) => [key, ceilings[key] as number])) as Record<CeilingKey, number>),
  });
};

export const LIMITS_URL = new URL("./limits.json", import.meta.url);
const limits = parseLimits(JSON.parse(readFileSync(LIMITS_URL, "utf8")));

export const STACK_DATASET = limits.stack.dataset;
export const STACK_RELEASE = limits.stack.release;
export const STACK_REVISION = limits.stack.revision;
export const CAPACITY_CEILINGS: Readonly<Record<CeilingKey, number>> = limits.ceilings;
