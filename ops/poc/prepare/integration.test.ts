const testModuleName: string = "vitest";
const { describe, expect, it, vi } = await import(testModuleName) as any;
import { prepareLocalExperiment } from "./index";
import { parseRunReport } from "./run-report";
import { canonicalArtifactHash } from "./canonical";
const captureModulePath: string = "./testdata/captured-run";
const captureModule = await import(captureModulePath).catch(() => ({})) as Record<string, unknown>;
type CapturedFailure = "malformed" | "capacity" | "freshness" | "credential"
  | "redirect" | "retry" | "cleanup" | "insufficient";
const createCapturedHarness = captureModule.createCapturedHarness as (options: Readonly<{
  observedAt: string;
  executionId: string;
  failure?: CapturedFailure;
  providerIncompleteQueryId?: string;
}>) => Promise<any>;
const failureMatrix = [
  ["malformed", "github-search:GITHUB_SEARCH_REJECTED"],
  ["capacity", "capacity:BLOB_ATTEMPTS"],
  ["freshness", "preflight:REVISION_MISMATCH"],
  ["credential", "stack-metadata-Python:ENVIRONMENT_REJECTED"],
  ["redirect", "preflight:ACCESS_UNAVAILABLE"],
  ["retry", "github-search:LOGICAL_RETRY_LIMIT"],
  ["cleanup", "stack-metadata-Python:WORKER_EXIT"],
  ["insufficient", "github-search:candidates-2"],
] as const;
const rejectLiveNetwork = async (operation: (attempts: string[]) => Promise<void>): Promise<void> => {
  const attempts: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    attempts.push(String(input));
    throw new Error("LIVE_NETWORK_REJECTED");
  });
  try {
    await operation(attempts);
  } finally {
    vi.unstubAllGlobals();
  }
};
const decodeReport = (bytes: Uint8Array): any =>
  parseRunReport(JSON.parse(new TextDecoder().decode(bytes)));
const createCapturedPair = (providerIncompleteQueryId?: string): Promise<[any, any]> => Promise.all([
  createCapturedHarness({
    observedAt: "2026-07-31T12:00:00.000Z",
    executionId: "11111111-1111-4111-8111-111111111111",
    ...(providerIncompleteQueryId ? { providerIncompleteQueryId } : {}),
  }),
  createCapturedHarness({
    observedAt: "2026-08-01T12:00:00.000Z",
    executionId: "22222222-2222-4222-8222-222222222222",
    ...(providerIncompleteQueryId ? { providerIncompleteQueryId } : {}),
  }),
]);
const expectCompletionSequence = (harness: any): void => {
  const report = harness.events.indexOf("report");
  const publicationStart = harness.events.indexOf("publish:start");
  const commit = harness.events.indexOf("report:commit");
  const publication = harness.events.indexOf("publish:complete");
  const finalize = harness.events.indexOf("report:finalize");
  const warning = harness.events.indexOf("log:GITHUB_SEARCH_INCOMPLETE");
  const completion = harness.events.indexOf("log:PREPARATION_COMPLETE");
  expect([report, publicationStart, commit, publication, finalize, warning, completion].every((index) => index >= 0)).toBe(true);
  expect(harness.events).not.toContain("report:rollback");
  expect(report).toBeLessThan(publicationStart);
  expect(publicationStart).toBeLessThan(commit);
  expect(commit).toBeLessThan(publication);
  expect(publication).toBeLessThan(finalize);
  expect(finalize).toBeLessThan(warning);
  expect(warning).toBeLessThan(completion);
};

describe("captured preparation harness", () => {
  it("provides an isolated captured-run harness", () => {
    expect(captureModule.createCapturedHarness).toBeTypeOf("function");
  });
});

describe("captured two-source preparation", () => {
  it("replays both captured source lanes into identical artifacts and distinct reports", async () => {
    const [first, second] = await createCapturedPair();
    expect(first.dependencies).toBeDefined();
    try {
      await rejectLiveNetwork(async (liveAttempts) => {
        const firstResult = await prepareLocalExperiment(first.dependencies);
        const secondResult = await prepareLocalExperiment(second.dependencies);
        const firstArtifact = await first.readArtifact();
        const secondArtifact = await second.readArtifact();
        expect(firstResult.artifactHash).toBe(secondResult.artifactHash);
        expect(firstArtifact).toEqual(secondArtifact);
        expect(first.reports).toHaveLength(1);
        expect(second.reports).toHaveLength(1);
        expect(first.reports[0]).not.toEqual(second.reports[0]);
        expect(first.logs).toEqual(["PREPARATION_COMPLETE"]);
        expect(second.logs).toEqual(["PREPARATION_COMPLETE"]);
        const artifact = JSON.parse(new TextDecoder().decode(firstArtifact));
        expect(artifact.fixtures.map(({ kind }: { kind: string }) => kind)).toEqual([
          "PROVENANCE", "PROVENANCE", "PROVENANCE", "LANGUAGE", "LANGUAGE",
        ]);
        const outputText = [firstArtifact, ...first.reports, ...second.reports]
          .map((bytes) => new TextDecoder().decode(bytes)).join("\n");
        expect(first.sensitiveCanaries).toEqual([
          "captured-hf-token", "captured-github-token", "captured-provider-store",
          "discarded@example.test",
        ]);
        for (const canary of first.sensitiveCanaries) expect(outputText).not.toContain(canary);
        expect(liveAttempts).toEqual([]);
        expect(first.metadataConfigurations).toEqual(["Python", "TypeScript"]);
        expect(first.selectedBlobRows).toHaveLength(2);
        expect(first.requests.some((url: string) => url.includes("/search/commits"))).toBe(true);
        expect(first.requests.some((url: string) => url.includes("/git/trees/"))).toBe(true);
        expect(first.requests.some((url: string) => url.includes("/license?ref="))).toBe(true);
      });
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});

describe("captured provider-incomplete preparation", () => {
  it("records provider-incomplete captured searches without changing deterministic artifacts", async () => {
    const incompleteQueryId = "microsoft-generated-trailer";
    const [first, second] = await createCapturedPair(incompleteQueryId);
    try {
      await rejectLiveNetwork(async (liveAttempts) => {
        const firstResult = await prepareLocalExperiment(first.dependencies);
        const secondResult = await prepareLocalExperiment(second.dependencies);
        const firstArtifact = await first.readArtifact();
        const secondArtifact = await second.readArtifact();
        const artifacts = [firstArtifact, secondArtifact]
          .map((bytes) => JSON.parse(new TextDecoder().decode(bytes)));
        const results = [firstResult, secondResult];
        const reports = [first, second].map((harness) => decodeReport(harness.reports[0]));
        expect(firstArtifact).toEqual(secondArtifact);
        expect(firstResult.artifactHash).toBe(secondResult.artifactHash);
        expect(first.reports[0]).not.toEqual(second.reports[0]);
        expect(reports.map(({ githubQueries }: any) => githubQueries.map(({ id, completeness }: any) =>
          ({ id, completeness })))).toEqual(Array(2).fill([
          { id: incompleteQueryId, completeness: "PROVIDER_REPORTED_INCOMPLETE" },
          { id: "github-generated-trailer", completeness: "COMPLETE" },
          { id: "facebook-ordinary-change", completeness: "COMPLETE" },
        ]));
        for (const [index, result] of results.entries()) {
          const artifact = artifacts[index];
          const identity = {
            artifactHash: canonicalArtifactHash(artifact),
            crawlSnapshotId: artifact.crawlSnapshot.id,
          };
          expect(result).toMatchObject(identity);
          expect(reports[index].result).toMatchObject(identity);
        }
        for (const harness of [first, second]) {
          expect(harness.logs).toEqual(["GITHUB_SEARCH_INCOMPLETE", "PREPARATION_COMPLETE"]);
          expectCompletionSequence(harness);
        }
        const outputText = [firstArtifact, ...first.reports, ...second.reports]
          .map((bytes) => new TextDecoder().decode(bytes)).join("\n");
        for (const canary of first.sensitiveCanaries) expect(outputText).not.toContain(canary);
        expect(liveAttempts).toEqual([]);
      });
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});

describe("captured preparation failures", () => {
  it.each(failureMatrix)("fails closed for %s input without replacing the prior artifact", async (
    failure: CapturedFailure,
    expectedEvent: string,
  ) => {
    const harness = await createCapturedHarness({
      observedAt: "2026-07-31T12:00:00.000Z",
      executionId: "33333333-3333-4333-8333-333333333333",
      failure,
    });
    try {
      await rejectLiveNetwork(async (liveAttempts) => {
        const before = await harness.readArtifact();
        await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
        expect(await harness.readArtifact()).toEqual(before);
        expect([...before]).toEqual([...harness.initialArtifact]);
        expect(harness.reports).toHaveLength(0);
        expect(harness.events).toContain(expectedEvent);
        expect(liveAttempts).toEqual([]);
        if (failure === "cleanup") expect(harness.cleanupCount()).toBe(1);
      });
    } finally {
      await harness.dispose();
    }
  });
});
