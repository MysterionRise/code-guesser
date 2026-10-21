import { readFileSync } from "node:fs";

import { CAPACITY_CEILINGS, LIMITS_URL, parseLimits, STACK_REVISION } from "../limits";
import { loadProfile } from "./command-test-harness";
import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const raw = (): any => JSON.parse(readFileSync(LIMITS_URL, "utf8"));

describe("shared limits file", () => {
  it("pins the Stack revision and bounds the profile", async () => {
    const profile = await loadProfile();
    expect(profile.stack.revision).toBe(STACK_REVISION);
    for (const [key, value] of Object.entries(profile.capacity)) expect(value).toBeLessThanOrEqual(CAPACITY_CEILINGS[key as keyof typeof CAPACITY_CEILINGS]);
    // The v7 run's profile spends the ceilings raised for it in full (#167); the v1.0 run's stays within them (#129).
    const load = (version: string) =>
      parseCrawlProfile(JSON.parse(readFileSync(new URL(`../profiles/local-real-rounds.${version}.json`, import.meta.url), "utf8")));
    expect(load("v7").capacity).toEqual(CAPACITY_CEILINGS);
    expect(CAPACITY_CEILINGS.requestCount).toBe(10_000);
    expect(CAPACITY_CEILINGS.blobAttempts).toBe(600);
    expect(load("v6").capacity).toEqual({ ...CAPACITY_CEILINGS, requestCount: 5000, blobAttempts: 400 });
  });

  it("rejects a missing, extra, non-positive, or malformed entry", () => {
    const missing = raw(); delete missing.ceilings.requestCount;
    const extra = raw(); extra.ceilings.unbounded = 1;
    const zero = raw(); zero.ceilings.blobAttempts = 0;
    const revision = raw(); revision.stack.revision = "main";
    for (const value of [missing, extra, zero, revision, null, []]) expect(() => parseLimits(value)).toThrow("LIMITS_FILE_REJECTED");
    expect(parseLimits(raw()).ceilings).toEqual(CAPACITY_CEILINGS);
  });
});
