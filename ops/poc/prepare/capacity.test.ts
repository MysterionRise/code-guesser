import { createCapacityMeter, CapacityError } from "./capacity";
import { SIGNED_CAPACITY_CEILINGS, type CapacityLimits, STACK_LANGUAGES } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const limits = (overrides: Partial<CapacityLimits> = {}): CapacityLimits => ({
  ...SIGNED_CAPACITY_CEILINGS,
  ...overrides,
});

const meter = (overrides: Partial<CapacityLimits> = {}) => createCapacityMeter({
  limits: limits(overrides),
  githubQueryIds: ["first", "second"],
  stackLanguages: STACK_LANGUAGES,
});

describe("preparation capacity", () => {
  it("exposes a bounded capacity meter", async () => {
    const moduleName: string = "./capacity";
    const capacityModule = await import(moduleName).catch(() => ({})) as Record<string, unknown>;

    expect(capacityModule.createCapacityMeter).toBeTypeOf("function");
  });

  it("accepts lower profile limits and rejects every raised signed limit", () => {
    expect(() => meter({ githubPages: 2, temporaryDiskBytes: 1024 })).not.toThrow();

    for (const key of Object.keys(SIGNED_CAPACITY_CEILINGS) as (keyof CapacityLimits)[]) {
      expect(() => meter({ [key]: SIGNED_CAPACITY_CEILINGS[key] + 1 })).toThrow(CapacityError);
    }
  });

  it("meters exact per-query GitHub pages and results without corrupting rejected increments", () => {
    const capacity = meter();
    capacity.recordGitHubPage("first", 100);
    capacity.recordGitHubPage("first", 100);
    capacity.recordGitHubPage("first", 100);
    const exact = capacity.snapshot();

    expect(exact.github.first).toEqual({ pages: 3, results: 300 });
    expect(() => capacity.recordGitHubPage("first", 0)).toThrow(CapacityError);
    expect(() => capacity.recordGitHubPage("second", 301)).toThrow(CapacityError);
    expect(() => capacity.recordGitHubPage("unknown", 1)).toThrow(CapacityError);
    expect(capacity.snapshot()).toEqual(exact);
  });

  it("meters exact per-language rows and total Stack metadata bytes", () => {
    const capacity = meter();
    capacity.recordStackRows("Python", 10_000, 96 * 1024 * 1024);
    const exact = capacity.snapshot();

    expect(exact.stackRows).toEqual({ Python: 10_000, TypeScript: 0, Go: 0, Rust: 0, Ruby: 0 });
    expect(exact.stackMetadataBytes).toBe(96 * 1024 * 1024);
    expect(() => capacity.recordStackRows("Python", 1, 0)).toThrow(CapacityError);
    expect(() => capacity.recordStackRows("TypeScript", 0, 1)).toThrow(CapacityError);
    expect(capacity.snapshot()).toEqual(exact);
  });

  it("meters blob attempts, successes, per-blob bytes, and total bytes independently", () => {
    const attempts = meter();
    for (let index = 0; index < 50; index += 1) attempts.beginBlob().release();
    const attemptSnapshot = attempts.snapshot();
    expect(attemptSnapshot.blobAttempts).toBe(50);
    expect(() => attempts.beginBlob()).toThrow(CapacityError);
    expect(attempts.snapshot()).toEqual(attemptSnapshot);

    const successes = meter({ successfulBlobs: 1 });
    const accepted = successes.beginBlob();
    accepted.addBytes(1);
    accepted.accept();
    const rejected = successes.beginBlob();
    rejected.addBytes(1);
    expect(() => rejected.accept()).toThrow(CapacityError);
    rejected.release();
    expect(successes.snapshot().successfulBlobs).toBe(1);

    const bytes = meter({ totalBlobBytes: 256 * 1024 });
    const first = bytes.beginBlob();
    first.addBytes(256 * 1024);
    expect(() => first.addBytes(1)).toThrow(CapacityError);
    first.release();
    const second = bytes.beginBlob();
    expect(() => second.addBytes(1)).toThrow(CapacityError);
    second.release();
    expect(bytes.snapshot().totalBlobBytes).toBe(256 * 1024);
  });

  it("meters request count, active concurrency, and each response while always releasing leases", () => {
    const concurrent = meter();
    const leases = Array.from({ length: 4 }, () => concurrent.beginRequest());
    expect(() => concurrent.beginRequest()).toThrow(CapacityError);
    leases[0]!.release();
    const replacement = concurrent.beginRequest();
    replacement.complete(8 * 1024 * 1024);
    const beforeRejection = concurrent.snapshot();
    leases[1]!.complete(0);
    leases[2]!.release();
    leases[3]!.release();
    const oversized = concurrent.beginRequest();
    expect(() => oversized.complete(8 * 1024 * 1024 + 1)).toThrow(CapacityError);
    expect(concurrent.snapshot().activeRequests).toBe(0);
    expect(concurrent.snapshot().responseBytes).toBe(beforeRejection.responseBytes);

    const requests = meter();
    for (let index = 0; index < 600; index += 1) requests.beginRequest().release();
    expect(requests.snapshot().requestCount).toBe(600);
    expect(() => requests.beginRequest()).toThrow(CapacityError);
  });

  it("meters single, cumulative, and retry-count wait ceilings transactionally", () => {
    const waits = meter();
    waits.recordRetryWait(15_000);
    waits.recordRetryWait(15_000);
    const exact = waits.snapshot();
    expect(exact.waitedMilliseconds).toBe(30_000);
    expect(() => waits.recordRetryWait(1)).toThrow(CapacityError);
    expect(waits.snapshot()).toEqual(exact);

    const single = meter();
    expect(() => single.recordRetryWait(15_001)).toThrow(CapacityError);
    expect(single.snapshot().retryWaits).toBe(0);

    const retries = meter();
    retries.recordRetryWait(1);
    retries.recordRetryWait(1);
    retries.recordRetryWait(1);
    expect(() => retries.recordRetryWait(1)).toThrow(CapacityError);
    expect(retries.snapshot().retryWaits).toBe(3);
  });

  it("meters live and peak temporary disk with idempotent release and frozen snapshots", () => {
    const capacity = meter();
    const release = capacity.reserveTemporaryDisk(32 * 1024 * 1024);
    const exact = capacity.snapshot();

    expect(exact.temporaryDiskBytes).toBe(32 * 1024 * 1024);
    expect(exact.peakTemporaryDiskBytes).toBe(32 * 1024 * 1024);
    expect(() => capacity.reserveTemporaryDisk(1)).toThrow(CapacityError);
    expect(capacity.snapshot()).toEqual(exact);
    release();
    release();
    const released = capacity.snapshot();
    expect(released.temporaryDiskBytes).toBe(0);
    expect(released.peakTemporaryDiskBytes).toBe(32 * 1024 * 1024);
    expect(Object.isFrozen(released)).toBe(true);
    expect(Object.isFrozen(released.github)).toBe(true);
    expect(Object.isFrozen(released.github.first)).toBe(true);
    expect(Object.isFrozen(released.stackRows)).toBe(true);
  });

  it("meters worker-reported requests against the shared request ceiling", () => {
    const capacity = meter();
    capacity.recordWorkerRequests(0);
    capacity.recordWorkerRequests(599);
    expect(capacity.snapshot().requestCount).toBe(599);
    capacity.beginRequest().release();
    expect(capacity.snapshot().requestCount).toBe(600);
    expect(() => capacity.recordWorkerRequests(1)).toThrow(CapacityError);
    expect(() => capacity.recordWorkerRequests(1)).toThrow("REQUEST_COUNT");
    expect(() => capacity.recordWorkerRequests(-1)).toThrow(CapacityError);
    expect(() => capacity.recordWorkerRequests(1.5)).toThrow(CapacityError);
    expect(capacity.snapshot().requestCount).toBe(600);
    expect(() => capacity.beginRequest()).toThrow(CapacityError);
  });
});
