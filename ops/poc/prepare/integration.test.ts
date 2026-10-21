import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const testModuleName: string = "vitest";
const { describe, expect, it, vi } = await import(testModuleName) as any;
import { MAINSTREAM_LANGUAGES } from "./profile";
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
const isCoreRequest = captureModule.isCoreRequest as (url: string) => boolean;
const failureMatrix = [
  ["malformed", "github-search:GITHUB_SEARCH_REJECTED"],
  ["freshness", "preflight:REVISION_MISMATCH"],
  ["credential", "stack-metadata-Python:ENVIRONMENT_REJECTED"],
  ["redirect", "preflight:ACCESS_UNAVAILABLE"],
  ["retry", "github-search:LOGICAL_RETRY_LIMIT"],
  ["cleanup", "stack-metadata-Python:WORKER_EXIT"],
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
        for (const logs of [first.logs, second.logs]) {
          expect(logs).toHaveLength(3);
          expect(logs[0]).toBe("PREPARATION_DECKS project,language,before-after");
          expect(logs[1]).toMatch(/^PREPARATION_SPEND (?:[A-Z_]+=\d+ )*total=\d+$/u);
          expect(logs[2]).toBe("PREPARATION_COMPLETE");
        }
        const artifact = JSON.parse(new TextDecoder().decode(firstArtifact));
        const pool = 2 * MAINSTREAM_LANGUAGES.length;
        expect(artifact.decks.map(({ id, fixtures }: any) => `${id}:${fixtures.map(({ kind }: any) => kind).join(",")}`)).toEqual([
          `project:${Array(pool).fill("PROJECT").join(",")}`,
          `language:${Array(pool).fill("LANGUAGE").join(",")}`,
          "before-after:BEFORE_AFTER,BEFORE_AFTER,BEFORE_AFTER,BEFORE_AFTER,BEFORE_AFTER",
        ]);
        const outputText = [firstArtifact, ...first.reports, ...second.reports]
          .map((bytes) => new TextDecoder().decode(bytes)).join("\n");
        expect(first.sensitiveCanaries).toEqual([
          "captured-hf-token", "captured-github-token", "captured-provider-store",
          "discarded@example.test",
        ]);
        for (const canary of first.sensitiveCanaries) expect(outputText).not.toContain(canary);
        expect(liveAttempts).toEqual([]);
        expect(first.metadataConfigurations).toEqual([...MAINSTREAM_LANGUAGES]);
        // Two popular files per language for the project deck and two ordinary files per language for the language deck.
        expect(first.selectedBlobRows).toHaveLength(2 * pool);
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
  it("fails closed on a provider-incomplete page that a fresh pass does not repair", async () => {
    const [first] = await createCapturedPair("refactor-facebook");
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

describe("captured partial preparation", () => {
  it.each([
    ["capacity", "PREPARATION_DECK_SKIPPED project BUDGET_EXHAUSTED_BLOB_ATTEMPTS", "PREPARATION_DECKS before-after"],
    ["insufficient", "PREPARATION_DECK_SKIPPED before-after DECK_SHORT", "PREPARATION_DECKS project,language"],
  ] as const)("publishes the decks that filled when %s input leaves one short", async (failure: CapturedFailure, skipped: string, published: string) => {
    const harness = await createCapturedHarness({
      observedAt: "2026-07-31T12:00:00.000Z",
      executionId: "44444444-4444-4444-8444-444444444444",
      failure,
    });
    try {
      await rejectLiveNetwork(async (liveAttempts) => {
        await prepareLocalExperiment(harness.dependencies);
        expect(harness.logs).toContain(skipped);
        expect(harness.logs).toContain(published);
        expect(harness.reports).toHaveLength(1);
        expect(liveAttempts).toEqual([]);
      });
    } finally {
      await harness.dispose();
    }
  });
});

describe("captured rate-limit checkpoint (#165)", () => {
  const journalIn = (): string => join(mkdtempSync(join(tmpdir(), "codeguessr-checkpoint-")), "run.jsonl");
  const run = (executionId: string, journal: Readonly<{ mode: "fresh" | "resume"; path: string }>, coreLimit?: unknown) =>
    createCapturedHarness({ observedAt: "2026-07-31T12:00:00.000Z", executionId, journal, ...(coreLimit ? { coreLimit } : {}) } as any);

  it.each([
    // Another client spent the token's limit: GitHub still reports plenty left, then refuses with a 403.
    ["refuses a request with a 403", (spent: number) => ({ requests: spent, reported: 5000 }), "4xx", 1],
    // GitHub's own count reaches the reserve: the run holds the next request back instead of sending it.
    ["reports too few requests left", (spent: number) => ({ requests: spent + 25, reported: spent + 25 }), "none", 0],
  ] as const)("stops when GitHub %s, journals the run, and resumes to the artifact of an uninterrupted run", async (
    _name: string, coreLimit: (spent: number) => unknown, statusClass: string, refused: number,
  ) => {
    const uninterrupted = await run("55555555-5555-4555-8555-555555555555", { mode: "fresh", path: journalIn() });
    const path = journalIn();
    try {
      await rejectLiveNetwork(async (liveAttempts) => {
        const expected = await prepareLocalExperiment(uninterrupted.dependencies);
        const coreRequests = uninterrupted.requests.filter(isCoreRequest).length;
        const spent = Math.floor(coreRequests / 2);

        const limited = await run("66666666-6666-4666-8666-666666666666", { mode: "fresh", path }, coreLimit(spent));
        try {
          const failure = await prepareLocalExperiment(limited.dependencies).catch((error: unknown) => error);
          expect(failure).toMatchObject({ message: "PREPARATION_FAILED", stop: "RATE_LIMIT_CHECKPOINT" });
          expect(limited.requests.filter(isCoreRequest)).toHaveLength(spent + refused);
          expect(limited.logs.find((line: string) => line.startsWith("PREPARATION_STAGE_FAILED ")))
            .toMatch(new RegExp(`^PREPARATION_STAGE_FAILED [A-Z_]+ RATE_LIMIT_CHECKPOINT ${statusClass}$`, "u"));
          // No candidate was rejected for the limit, so no deck ran short; nothing was published.
          expect(limited.logs.some((line: string) => line.startsWith("PREPARATION_DECK_SKIPPED"))).toBe(false);
          expect(limited.logs.join("\n")).not.toMatch(/=UNSUPPORTED_STATUS|RATE_LIMIT_CHECKPOINT=/u);
          expect(limited.logs.slice(-3)).toEqual([
            expect.stringMatching(/^PREPARATION_JOURNAL mode=fresh replayed=0 live=[1-9]\d*$/u),
            expect.stringMatching(/^PREPARATION_RESUME_AFTER \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/u),
            "PREPARATION_FAILED",
          ]);
          expect(limited.reports).toHaveLength(0);
          expect([...await limited.readArtifact()]).toEqual([...limited.initialArtifact]);
          expect(existsSync(path)).toBe(true);
        } finally {
          await limited.dispose();
        }

        // An hour later GitHub answers again: the resumed run replays what the journal holds and fetches the rest.
        const resumed = await run("77777777-7777-4777-8777-777777777777", { mode: "resume", path });
        try {
          const result = await prepareLocalExperiment(resumed.dependencies);
          expect(result.artifactHash).toBe(expected.artifactHash);
          expect(await resumed.readArtifact()).toEqual(await uninterrupted.readArtifact());
          expect(resumed.requests.filter(isCoreRequest)).toHaveLength(coreRequests - spent);
          expect(resumed.logs.at(-1)).toBe("PREPARATION_COMPLETE");
        } finally {
          await resumed.dispose();
        }
        expect(liveAttempts).toEqual([]);
      });
    } finally {
      await uninterrupted.dispose();
      rmSync(dirname(path), { recursive: true, force: true });
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
