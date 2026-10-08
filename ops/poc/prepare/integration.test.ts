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
  ["insufficient", "github-search:candidates-7"],
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
        expect(artifact.decks.map(({ id, fixtures }: any) => `${id}:${fixtures.map(({ kind }: any) => kind).join(",")}`)).toEqual([
          "project:PROJECT,PROJECT,PROJECT,PROJECT,PROJECT",
          "language:LANGUAGE,LANGUAGE,LANGUAGE,LANGUAGE,LANGUAGE",
          "ai:AI_CREDIT,AI_CREDIT,AI_CREDIT,AI_CREDIT,AI_CREDIT",
        ]);
        const outputText = [firstArtifact, ...first.reports, ...second.reports]
          .map((bytes) => new TextDecoder().decode(bytes)).join("\n");
        expect(first.sensitiveCanaries).toEqual([
          "captured-hf-token", "captured-github-token", "captured-provider-store",
          "discarded@example.test",
        ]);
        for (const canary of first.sensitiveCanaries) expect(outputText).not.toContain(canary);
        expect(liveAttempts).toEqual([]);
        expect(first.metadataConfigurations).toEqual(["Python", "TypeScript", "Go", "Rust", "Ruby"]);
        expect(first.selectedBlobRows).toHaveLength(5);
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
  it("fails closed on a provider-incomplete page because revision 12 authorizes no incomplete query", async () => {
    const [first] = await createCapturedPair("ai-copilot-github");
    try {
      await rejectLiveNetwork(async (liveAttempts) => {
        const before = await first.readArtifact();
        await expect(prepareLocalExperiment(first.dependencies)).rejects.toThrow("PREPARATION_FAILED");
        expect(await first.readArtifact()).toEqual(before);
        expect(first.reports).toHaveLength(0);
        expect(first.events).toContain("github-search:GITHUB_SEARCH_REJECTED");
        expect(first.logs).not.toContain("GITHUB_SEARCH_INCOMPLETE");
        expect(liveAttempts).toEqual([]);
      });
    } finally {
      await first.dispose();
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
