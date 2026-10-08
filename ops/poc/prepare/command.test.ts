import { readFile } from "node:fs/promises";

import { canonicalHash } from "./canonical";
import { createCapacityMeter } from "./capacity";
import { HARNESS_CANDIDATES, HARNESS_CREDIT, accepted, classificationsFor, hash, loadProfile, makeHarness } from "./command-test-harness";
import { STACK_LANGUAGES } from "./profile";
import { RetryError } from "./retry";
import { createRunReport } from "./run-report";
import { TransportError } from "./transport";
import {
  prepareLocalExperiment,
  projectPreparationEnvironment,
  runPreparationCli,
  type PreparationDependencies,
  type PreparationResult,
} from "./index";

const testModuleName: string = "vitest";
const { afterEach, describe, expect, it } = await import(testModuleName) as any;
const sourcePath = new URL("./index.ts", import.meta.url);
const originalArguments = [...process.argv];
afterEach(() => { process.argv.splice(0, process.argv.length, ...originalArguments); });
const admittedWith = (candidate: any, source: Record<string, unknown> = {}) => accepted({
  admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage: candidate, source: {
    repository: candidate.repository, commit: String(candidate.id).padStart(40, "c"), path: `src/file-${candidate.id}.ts`,
    blob: String(candidate.id).padStart(40, "b"), rawContentHash: String(candidate.id).padStart(64, "r"),
    excerptHash: String(candidate.id).padStart(64, "e"), queryId: candidate.queryId, ...source,
  },
}, "4");
const stackRowsWith = (python: readonly object[], others: Partial<Record<string, readonly object[]>> = {}) =>
  Object.fromEntries(STACK_LANGUAGES.map((language) => [language, language === "Python" ? python
    : others[language] ?? [{ id: language.toLowerCase(), detectedLanguage: language }]])) as Record<string, readonly object[]>;
const metadataFrom = (rows: Record<string, readonly object[]>): PreparationDependencies["collectStackMetadata"] =>
  async ({ configuration, capacity }) => {
    capacity.recordStackRows(configuration, rows[configuration]!.length, 100);
    return accepted(rows[configuration]!, String(5 + STACK_LANGUAGES.indexOf(configuration)));
  };
const searchWith = (queryClassifications: unknown): PreparationDependencies["searchGitHub"] => async () => accepted({
  candidates: HARNESS_CANDIDATES,
  queryClassifications,
} as any, "2");

describe("local experiment preparation command", () => {
/** Marker lines only; the failure-site line is asserted separately. */
const logLines = (calls: readonly string[]): string[] =>
  calls.filter((call) => call.startsWith("log:") && !call.startsWith("log:PREPARATION_FAILURE_SITE "));

  it("exposes one preparation entry point and one no-argument project command", async () => {
    expect(prepareLocalExperiment).toBeTypeOf("function");
    expect(runPreparationCli).toBeTypeOf("function");
    const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(manifest.scripts["prepare:poc"]).toBe("node --import tsx ops/poc/prepare/index.ts");
  });

  it("runs preflight first, both mandatory lanes, the exact 5/5/5 deck composition, report, then publication", async () => {
    const harness = await makeHarness();
    const result = await prepareLocalExperiment(harness.dependencies) as PreparationResult;

    expect(harness.calls.indexOf("preflight")).toBeLessThan(harness.calls.indexOf("search"));
    expect(harness.calls.indexOf("preflight")).toBeLessThan(harness.calls.indexOf("metadata:Python"));
    expect(harness.calls.filter((call) => call.startsWith("metadata:"))).toEqual(STACK_LANGUAGES.map((language) => `metadata:${language}`));
    expect(harness.calls).toContain("project:5:8");
    expect(harness.calls).toContain("language:5");
    expect(harness.calls).toContain("ai:5");
    expect(harness.calls).toContain("compose:5/5/5");
    expect(harness.calls.indexOf("report:stage")).toBeLessThan(harness.calls.indexOf("publish"));
    expect(harness.calls.indexOf("publish")).toBeLessThan(harness.calls.indexOf("report:commit"));
    expect(harness.calls.indexOf("report:commit")).toBeLessThan(harness.calls.indexOf("report:finalize"));
    expect(harness.calls.indexOf("report:finalize")).toBeLessThan(harness.calls.indexOf("log:PREPARATION_COMPLETE"));
    expect(harness.calls).not.toContain("report:rollback");
    expect(result.artifactHash).toBe(hash("9"));
    expect(harness.published).toHaveLength(1);
    expect(harness.reports).toHaveLength(1);
  });

  it("checks language-round eligibility before lease acceptance and continues with frozen limits", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);

    expect(new Set(harness.dependencyMeters).size).toBe(1);
    expect(harness.calls.filter((call) => call.startsWith("fetch:"))).toEqual([
      "fetch:py-reject:50:16777216", "fetch:py:49:16777136", "fetch:typescript:48:16777056",
      "fetch:go:47:16776976", "fetch:rust:46:16776896", "fetch:ruby:45:16776816",
    ]);
    expect(harness.calls.filter((call) => call.startsWith("eligible:"))).toEqual([
      "eligible:py-reject", "eligible:py", "eligible:typescript", "eligible:go", "eligible:rust", "eligible:ruby",
    ]);
    expect(harness.leases).toEqual([
      { accepted: false, released: true, bytes: 80 },
      ...Array(5).fill({ accepted: true, released: false, bytes: 80 }),
    ]);
  });

  it("continues past rejected admissions until the project deck has five repositories, then fills the AI deck", async () => {
    const rejected: number[] = [];
    let projectIds: unknown[] = []; let aiIds: unknown[] = [];
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        const id = (candidate as any).id as number;
        if (id === 1) { rejected.push(id); throw new Error("REPOSITORY_REJECTED"); }
        return admittedWith(candidate);
      },
      generateProject: ({ candidates }) => { projectIds = candidates.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "PROJECT" }) } as any; },
      generateAi: ({ candidates }) => { aiIds = candidates.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "AI_CREDIT" }) } as any; },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(rejected).toEqual([1]);
    expect(projectIds).toEqual([0, 2, 3, 4, 5]);
    expect(aiIds).toEqual([20, 21, 22, 6, 7]);
  });

  it("skips a search candidate whose repository the deck already holds before spending any lineage request", async () => {
    const profile = await loadProfile();
    const candidates = [
      { id: 0, queryId: "ordinary-facebook", repository: "same/repo" },
      { id: 1, queryId: "ordinary-facebook", repository: "same/repo" },
      { id: 2, queryId: "ordinary-facebook", repository: "same/repo" },
      ...[3, 4, 5, 6, 7, 8].map((id) => ({ id, queryId: "ordinary-facebook", repository: `org${id}/repo-${id}` })),
      { id: 20, queryId: "ai-copilot-github", repository: "ai/repo" },
      { id: 21, queryId: "ai-copilot-github", repository: "ai/repo" },
      { id: 22, queryId: "ai-copilot-github", repository: "org22/repo-22" },
      { id: 23, queryId: "ai-copilot-github", repository: "org23/repo-23" },
    ];
    let projectIds: unknown[] = []; let aiIds: unknown[] = [];
    const harness = await makeHarness({
      searchGitHub: async () => accepted({ candidates, queryClassifications: classificationsFor(profile) }, "2"),
      generateProject: ({ candidates: selected }) => { projectIds = selected.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "PROJECT" }) } as any; },
      generateAi: ({ candidates: selected }) => { aiIds = selected.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "AI_CREDIT" }) } as any; },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("lineage:"))).toEqual(
      [0, 3, 4, 5, 6, 20, 22, 23, 7, 8].map((id) => `lineage:${id}`),
    );
    expect(projectIds).toEqual([0, 3, 4, 5, 6]);
    expect(aiIds).toEqual([20, 22, 23, 7, 8]);
    const report = harness.reports[0] as any;
    expect(report.diagnostics).toContainEqual({ stage: "DEDUPLICATION", reasonCode: "REPOSITORY_REPEATED", count: 3 });
    expect(report.counts.duplicatesRejected).toBe(3);
  });

  it("stops spending project requests on a repository whose excerpt already named its own project", async () => {
    const profile = await loadProfile();
    const candidates = [
      { id: 0, queryId: "ordinary-facebook", repository: "widgets/gizmo" },
      { id: 1, queryId: "ordinary-facebook", repository: "widgets/gizmo" },
      ...[2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, queryId: "ordinary-facebook", repository: `org${id}/repo-${id}` })),
      ...[20, 21, 22].map((id) => ({ id, queryId: "ai-copilot-github", repository: `org${id}/repo-${id}` })),
    ];
    let projectIds: unknown[] = [];
    const harness = await makeHarness({
      searchGitHub: async () => accepted({ candidates, queryClassifications: classificationsFor(profile) }, "2"),
      bindGitHubLineage: async ({ candidate }: any) => {
        harness.calls.push(`lineage:${candidate.id}`);
        return accepted({ ...candidate, excerpt: candidate.id === 0 ? "const gizmo = load(1000);" : `value_${candidate.id} = compute(${candidate.id}) + 1000`,
          commitMessage: candidate.id >= 20 ? `Fix\n\n${HARNESS_CREDIT}` : "ordinary refactor" }, "3");
      },
      generateProject: ({ candidates: selected }) => { projectIds = selected.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "PROJECT" }) } as any; },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).not.toContain("lineage:1");
    expect(projectIds).toEqual([2, 3, 4, 5, 6]);
    const diagnostics = (harness.reports[0] as any).diagnostics;
    expect(diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PROJECT_NAME_IN_EXCERPT", count: 1 });
    expect(diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PROJECT_REPOSITORY_SKIPPED", count: 1 });
  });

  it("keeps at least two credited and two uncredited AI rounds, filling from ordinary commits", async () => {
    let aiIds: unknown[] = [];
    const lineageFor = (uncredited: number) => async ({ candidate }: any) => {
      const id = candidate.id as number;
      return accepted({ ...candidate, excerpt: `value_${id} = compute(${id}) + 1000`,
        commitMessage: id >= 20 && id !== uncredited ? `Fix\n\n${HARNESS_CREDIT}` : "ordinary refactor" }, "3");
    };
    const harness = await makeHarness({
      bindGitHubLineage: lineageFor(21),
      generateAi: ({ candidates }) => { aiIds = candidates.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "AI_CREDIT" }) } as any; },
    });
    await prepareLocalExperiment(harness.dependencies);
    expect(aiIds).toEqual([20, 22, 5, 6, 7]);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "AI_CREDIT_ABSENT", count: 1 });

    const scarce = await makeHarness({ bindGitHubLineage: async ({ candidate }: any) => accepted({ ...candidate,
      excerpt: `value_${candidate.id} = compute(${candidate.id}) + 1000`,
      commitMessage: candidate.id === 20 ? `Fix\n\n${HARNESS_CREDIT}` : "ordinary refactor" }, "3") });
    await expect(prepareLocalExperiment(scarce.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(scarce.published).toEqual([]);
  });

  it("rejects a duplicate within the project deck and across decks, then continues to unique replacements", async () => {
    let projectIds: unknown[] = []; let aiIds: unknown[] = [];
    const duplicateHash = hash("d");
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => admittedWith(candidate,
        (candidate as any).id < 2 ? { rawContentHash: duplicateHash } : {}),
      generateProject: ({ candidates }) => { projectIds = candidates.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "PROJECT" }) } as any; },
      generateAi: ({ candidates }) => { aiIds = candidates.map((candidate: any) => candidate.lineage.id); return { fixtures: Array(5).fill({ kind: "AI_CREDIT" }) } as any; },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(projectIds).toEqual([0, 2, 3, 4, 5]);
    expect(aiIds).toEqual([20, 21, 22, 6, 7]);
    expect((harness.reports[0] as any).diagnostics).toContainEqual(
      { stage: "DEDUPLICATION", reasonCode: "SOURCE_DUPLICATE", count: 2 },
    );
  });

  it("orders Stack candidates by the profile keys and continues after cross-source deduplication", async () => {
    const collisionHash = hash("c");
    const stackRows = stackRowsWith([
      { id: "late", detectedLanguage: "Python", stableRowId: hash("2"), repository: "stack/late",
        swhRevisionId: "2".repeat(40), path: "late.py", swhContentId: "2".repeat(40), rawContentHash: hash("d") },
      { id: "collision", detectedLanguage: "Python", stableRowId: hash("1"), repository: "stack/collision",
        swhRevisionId: "1".repeat(40), path: "collision.py", swhContentId: "1".repeat(40), rawContentHash: collisionHash },
    ]);
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => admittedWith(candidate,
        (candidate as any).id === 0 ? { rawContentHash: collisionHash } : {}),
      collectStackMetadata: metadataFrom(stackRows),
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("fetch:")).slice(0, 3)).toEqual([
      "fetch:collision:50:16777216", "fetch:late:49:16777136", "fetch:typescript:48:16777056",
    ]);
    expect(harness.leases[0]).toMatchObject({ accepted: false, released: true });
  });

  it("continues after an independently duplicated Stack language candidate", async () => {
    const duplicateHash = hash("d");
    const rows = stackRowsWith([{ id: "py", detectedLanguage: "Python", stableRowId: hash("1"), repository: "stack/py",
      swhRevisionId: "1".repeat(40), path: "round.py", swhContentId: "1".repeat(40), rawContentHash: duplicateHash }], {
      TypeScript: [
        { id: "ts-late", detectedLanguage: "TypeScript", stableRowId: hash("3"), repository: "stack/late",
          swhRevisionId: "3".repeat(40), path: "late.ts", swhContentId: "3".repeat(40), rawContentHash: hash("e") },
        { id: "ts-duplicate", detectedLanguage: "TypeScript", stableRowId: hash("2"), repository: "stack/duplicate",
          swhRevisionId: "2".repeat(40), path: "duplicate.ts", swhContentId: "2".repeat(40), rawContentHash: duplicateHash },
      ],
    });
    const harness = await makeHarness({ collectStackMetadata: metadataFrom(rows) });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("fetch:")).slice(0, 3)).toEqual([
      "fetch:py:50:16777216", "fetch:ts-duplicate:49:16777136", "fetch:ts-late:48:16777056",
    ]);
    expect(harness.leases[1]).toMatchObject({ accepted: false, released: true });
  });

  it("never publishes on insufficient selection, composition, or report failure", async () => {
    const failures: Partial<PreparationDependencies>[] = [
      { collectStackMetadata: async () => accepted([], "5") },
      { compose: () => { throw new Error("COMPOSE_REJECTED"); } },
      { stageReport: async () => { throw new Error("REPORT_REJECTED"); } },
    ];
    for (const override of failures) {
      const harness = await makeHarness(override);
      await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow();
      expect(harness.published).toEqual([]);
    }
  });

  it("reports actual bounded counts and non-sensitive rejection reason codes", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);
    const report = harness.reports[0] as any;

    expect(report.counts).toMatchObject({
      repositoriesAdmitted: 10, blobAttempts: 6, blobsRetrieved: 5,
      githubRevalidations: 6, screened: 16, duplicatesRejected: 0, selected: 15,
    });
    expect(report.diagnostics).toEqual([
      { stage: "SCREENING", reasonCode: "LANGUAGE_ROUNDS_REJECTED", count: 1 },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/raw-secret|external-hf|external-gh/u);
  });

  it("passes the real strict run-report parser before writing", async () => {
    const harness = await makeHarness({ createReport: createRunReport });
    await prepareLocalExperiment(harness.dependencies);

    expect(Object.isFrozen(harness.reports[0])).toBe(true);
    expect((harness.reports[0] as any).outcome).toBe("SUCCESS");
  });

  it("binds provider-reported incompleteness to the successful run report", async () => {
    const profile = await loadProfile();
    const classifications = classificationsFor(profile, 1);
    const harness = await makeHarness({
      searchGitHub: searchWith(classifications),
      createReport: createRunReport,
    });

    const result = await prepareLocalExperiment(harness.dependencies);
    const report = harness.reports[0] as any;

    expect(report.githubQueries.map(({ id, completeness }: any) => ({ queryId: id, completeness })))
      .toEqual(classifications);
    expect(report.result).toMatchObject({
      artifactHash: result.artifactHash,
      crawlSnapshotId: result.crawlSnapshotId,
    });
  });

  it("warns exactly once after report commit and publication, then completes", async () => {
    const profile = await loadProfile();
    const harness = await makeHarness({ searchGitHub: searchWith(classificationsFor(profile, 1)) });

    await prepareLocalExperiment(harness.dependencies);

    expect(logLines(harness.calls)).toEqual([
      "log:GITHUB_SEARCH_INCOMPLETE",
      "log:PREPARATION_COMPLETE",
    ]);
    expect(harness.calls.indexOf("report:stage")).toBeLessThan(harness.calls.indexOf("publish"));
    expect(harness.calls.indexOf("publish")).toBeLessThan(harness.calls.indexOf("report:commit"));
    expect(harness.calls.indexOf("report:commit")).toBeLessThan(harness.calls.indexOf("log:GITHUB_SEARCH_INCOMPLETE"));
  });

  it("does not emit the incomplete warning for a complete search", async () => {
    const harness = await makeHarness();

    await prepareLocalExperiment(harness.dependencies);

    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_COMPLETE",
    ]);
  });

  it("fails closed on malformed injected query classifications", async () => {
    const profile = await loadProfile();
    const valid = classificationsFor(profile);
    const malformed = [
      ["missing", valid.slice(0, -1)],
      ["extra", [...valid, { queryId: "extra", completeness: "COMPLETE" }]],
      ["misordered", [valid[1], valid[0], ...valid.slice(2)]],
      ["mismatched", [{ ...valid[0], queryId: "wrong" }, ...valid.slice(1)]],
      ["duplicate", [valid[0], valid[0], ...valid.slice(2)]],
      ["unsupported", [{ ...valid[0], completeness: "INCOMPLETE" }, ...valid.slice(1)]],
    ] as const;

    for (const [_label, classifications] of malformed) {
      const harness = await makeHarness({ searchGitHub: searchWith(classifications) });
      await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
      expect(logLines(harness.calls)).toEqual([
        "log:PREPARATION_STAGE_FAILED DISCOVERY INVARIANT_REJECTED none",
        "log:PREPARATION_FAILED",
      ]);
      expect(harness.calls).not.toContain("report:stage");
      expect(harness.calls).not.toContain("publish");
    }
  });

  it("emits no incomplete or completion warning when publication fails", async () => {
    const profile = await loadProfile();
    const harness = await makeHarness({
      searchGitHub: searchWith(classificationsFor(profile, 1)),
      publishArtifact: async () => { throw new Error("PUBLICATION_REJECTED"); },
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");

    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED PUBLICATION PUBLICATION_REJECTED none",
      "log:PREPARATION_FAILED",
    ]);
  });

  it("never leaves a success report when artifact publication fails", async () => {
    const harness = await makeHarness({
      publishArtifact: async () => { throw new Error("PUBLICATION_REJECTED"); },
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");

    expect(harness.reports).toEqual([]);
    expect(harness.published).toEqual([]);
    expect(harness.calls).toContain("report:stage");
    expect(harness.calls).toContain("report:rollback");
    expect(harness.calls).not.toContain("report:commit");
    expect(harness.calls.indexOf("report:stage")).toBeLessThan(harness.calls.indexOf("report:rollback"));
  });

  it("rolls back a published artifact when the report cannot be committed", async () => {
    const harness = await makeHarness({
      stageReport: async () => {
        return {
          commit: async () => { throw new Error("REPORT_COMMIT_FAILED"); },
          rollback: async () => {},
          finalize: async () => {},
        };
      },
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");

    expect(harness.published).toEqual([]);
    expect(harness.reports).toEqual([]);
    expect(harness.calls).toContain("publish:rollback");
    expect(logLines(harness.calls)).toEqual([
      expect.stringMatching(/^log:PREPARATION_STAGE_FAILED PUBLICATION [A-Z][A-Z0-9_]* none$/u),
      "log:PREPARATION_FAILED",
    ]);
  });

  it("replays captured responses in order without a second live request", async () => {
    const command = await import("./index") as Record<string, any>;
    const profile = await loadProfile();
    const capacity = createCapacityMeter({ limits: profile.capacity,
      githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: STACK_LANGUAGES });
    let liveRequests = 0;
    const runtime = command.createPreparationRuntime(profile, { PATH: "/bin" }, capacity,
      async () => new Response(JSON.stringify({ sequence: ++liveRequests }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    const request = { provider: "huggingFace", method: "GET",
      url: "https://huggingface.co/api/datasets/bigcode/the-stack-v2", headers: { accept: "application/json" } };

    expect(await runtime.transport.requestJson(request)).toEqual({ sequence: 1 });
    expect(await runtime.transport.requestJson(request)).toEqual({ sequence: 2 });
    runtime.beginReplay();
    expect(await runtime.transport.requestJson(request)).toEqual({ sequence: 1 });
    expect(await runtime.transport.requestJson(request)).toEqual({ sequence: 2 });
    expect(liveRequests).toBe(2);
    expect(capacity.snapshot().requestCount).toBe(2);
  });

  it("rejects a composed snapshot that disagrees with captured hashes before publication", async () => {
    const harness = await makeHarness({
      compose: () => ({ artifact: { crawlSnapshot: { id: hash("e") }, decks: [] },
        artifactHash: hash("9"), artifactBytes: new Uint8Array([1]), roundRecordSet: {} } as any),
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.published).toEqual([]);
  });

  it("rejects replay-finalized source bindings that do not use the captured snapshot", async () => {
    const harness = await makeHarness({
      finalizeBindings: async ({ projectCandidates, aiCandidates, languageSelections }) => ({
        projectCandidates: projectCandidates.map((candidate: any) => ({ ...candidate,
          source: { ...(candidate.source ?? {}), crawlSnapshotId: hash("e") } })),
        aiCandidates,
        languageCandidates: languageSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId: hash("e") })),
      }),
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.published).toEqual([]);
  });

  it("binds replayed sources, composition, report, publication, and result to one captured snapshot", async () => {
    let finalizedId = "";
    const harness = await makeHarness({
      finalizeBindings: async ({ crawlSnapshotId, projectCandidates, aiCandidates, languageSelections }) => {
        finalizedId = crawlSnapshotId;
        const bind = (candidates: readonly unknown[]) => candidates.map((candidate: any) => ({ ...candidate,
          source: { ...(candidate.source ?? {}), crawlSnapshotId } }));
        return {
          projectCandidates: bind(projectCandidates), aiCandidates: bind(aiCandidates),
          languageCandidates: languageSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId })),
        };
      },
    });
    const profile = await loadProfile();
    const acceptedResponseHashes = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(hash);
    const expected = canonicalHash({ profileHash: canonicalHash(profile), acceptedResponseHashes });

    const result = await prepareLocalExperiment(harness.dependencies);
    expect(finalizedId).toBe(expected);
    expect(result.crawlSnapshotId).toBe(expected);
    expect((harness.reports[0] as any).result.crawlSnapshotId).toBe(expected);
    expect((harness.published[0] as any).artifact.crawlSnapshot.id).toBe(expected);
  });

  it("projects credentials from the environment only and rejects CLI arguments before loading dependencies", async () => {
    expect(projectPreparationEnvironment({
      PATH: "/bin", HF_TOKEN: "hf", GITHUB_TOKEN: "gh", AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session", NODE_OPTIONS: "--inspect",
      STACK_V2_ACKNOWLEDGED_USABLE_REVISION: "7".repeat(40), STACK_V2_ACKNOWLEDGED_REVISION: "wrong",
    })).toEqual({
      PATH: "/bin", HF_TOKEN: "hf", GITHUB_TOKEN: "gh", AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session",
      STACK_V2_ACKNOWLEDGED_USABLE_REVISION: "7".repeat(40),
    });
    process.argv.splice(0, process.argv.length, "node", "index.ts", "https://example.test/?token=secret");
    await expect(runPreparationCli()).rejects.toThrow("COMMAND_ARGUMENTS_REJECTED");
  });

  it("projects only AWS and provider-store values into the selected-blob worker", async () => {
    const command = await import("./index") as Record<string, any>;
    const source = {
      PATH: "/bin", HOME: "/external/home", HF_TOKEN: "hf", GITHUB_TOKEN: "gh",
      AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session",
      AWS_PROFILE: "poc", AWS_SHARED_CREDENTIALS_FILE: "/external/credentials",
      STACK_V2_ACKNOWLEDGED_USABLE_REVISION: "7".repeat(40),
    };

    expect(command.projectBlobWorkerEnvironment(source)).toEqual({
      PATH: "/bin", HOME: "/external/home", AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session", AWS_PROFILE: "poc",
      AWS_SHARED_CREDENTIALS_FILE: "/external/credentials",
    });
  });

  it("logs stage, reason code, and status class for every failure, naming uncoded ones safely", async () => {
    const uncoded = await makeHarness({
      searchGitHub: async () => { throw new TypeError("Cannot read properties of undefined (reading 'sha') https://example.test/?token=secret"); },
    });
    await expect(prepareLocalExperiment(uncoded.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(uncoded.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY UNCODED_TYPEERROR none",
      "log:PREPARATION_FAILED",
    ]);

    const diagnostic = { provider: "github", hostClass: "github", method: "GET", pathTemplate: "/search/commits",
      statusClass: "4xx", reasonCode: "UNSUPPORTED_STATUS" } as const;
    const search = await makeHarness({
      searchGitHub: async () => { throw new RetryError("RETRY_SIGNAL_MISSING", new TransportError("UNSUPPORTED_STATUS", diagnostic)); },
    });
    await expect(prepareLocalExperiment(search.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(search.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY RETRY_SIGNAL_MISSING 4xx",
      "log:PREPARATION_FAILED",
    ]);

    const preflight = await makeHarness({
      preflight: async () => { throw new TransportError("TIMEOUT", { ...diagnostic, provider: "huggingFace", hostClass: "huggingFace",
        pathTemplate: "/datasets/bigcode/the-stack-v2/{resource}", statusClass: "none", reasonCode: "TIMEOUT" }); },
    });
    await expect(prepareLocalExperiment(preflight.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(preflight.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED PREFLIGHT TIMEOUT none",
      "log:PREPARATION_FAILED",
    ]);

    const publication = await makeHarness({
      publishArtifact: async () => { throw Object.assign(new Error("PUBLICATION_FAILED"), { code: "PUBLICATION_FAILED" }); },
    });
    await expect(prepareLocalExperiment(publication.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(publication.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED PUBLICATION PUBLICATION_FAILED none",
      "log:PREPARATION_FAILED",
    ]);

    const unsafe = await makeHarness({
      searchGitHub: async () => { throw Object.assign(new Error("leak"), { code: "Bearer raw-secret", diagnostic: { statusClass: "https://x/?q=1" } }); },
    });
    await expect(prepareLocalExperiment(unsafe.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(unsafe.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY UNCODED_ERROR none",
      "log:PREPARATION_FAILED",
    ]);
  });

  it("logs pool counts and per-stage rejection codes when selection fails, never candidate detail", async () => {
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        throw new Error((candidate as any).id % 2 === 0 ? "LICENSE_REJECTED" : "https://github.com/owner/repo secret");
      },
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED ADMISSION INVARIANT_REJECTED none",
      "log:PREPARATION_COUNTS discovered=11 admitted=0 duplicates=0",
      "log:PREPARATION_REJECTIONS ADMISSION:CANDIDATE_REJECTED=4 ADMISSION:LICENSE_REJECTED=4",
      "log:PREPARATION_FAILED",
    ]);
    expect(harness.calls.join(" ")).not.toMatch(/owner\/repo|secret/u);
  });

  it("reports the transport cause behind a wrapped retry failure as the rejection code", async () => {
    const diagnostic = { provider: "github", hostClass: "github", method: "GET", pathTemplate: "/repos/{owner}/{repository}/{resource}",
      statusClass: "none", reasonCode: "REQUEST_LIMIT" } as const;
    const harness = await makeHarness({
      bindGitHubLineage: async () => { throw new RetryError("RETRY_SIGNAL_MISSING", new TransportError("REQUEST_LIMIT", diagnostic)); },
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(harness.calls)).toContain(
      "log:PREPARATION_REJECTIONS DISCOVERY:REQUEST_LIMIT=8",
    );
  });

  it("screens Stack rows by the profile licence allowlist before any blob is fetched", async () => {
    const harness = await makeHarness({
      collectStackMetadata: metadataFrom(stackRowsWith([
        { id: "py-gpl", detectedLanguage: "Python", detectedLicenses: ["GPL-3.0"] },
        { id: "py-mixed", detectedLanguage: "Python", detectedLicenses: ["MIT", "GPL-3.0"] },
        { id: "py-empty", detectedLanguage: "Python", detectedLicenses: [] },
        { id: "py-reject", detectedLanguage: "Python", detectedLicenses: ["MIT"] },
        { id: "py", detectedLanguage: "Python", detectedLicenses: ["Apache-2.0"] },
      ])),
    });

    await prepareLocalExperiment(harness.dependencies);

    const fetched = harness.calls.filter((call) => call.startsWith("fetch:")).map((call) => call.split(":")[1]);
    expect(fetched).toEqual(["py-reject", "py", "typescript", "go", "rust", "ruby"]);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "LICENSE_REJECTED", count: 3 });
  });

  it("names the failing function and file after every stage failure, without line numbers or data", async () => {
    function explodeInsideSearch(): never { throw new TypeError("Bearer leaked https://example.test/?token=x"); }
    const harness = await makeHarness({ searchGitHub: async () => explodeInsideSearch() });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    const site = harness.calls.find((call) => call.startsWith("log:PREPARATION_FAILURE_SITE "));
    expect(site).toBe("log:PREPARATION_FAILURE_SITE explodeInsideSearch@command.test.ts");
    expect(harness.calls.join(" ")).not.toMatch(/leaked|example\.test|token=|:\d+:\d+/u);
  });

  it("skips candidates whose public excerpt would reveal a protected value and keeps selecting", async () => {
    let projectIds: unknown[] = [];
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        const id = (candidate as any).id;
        const lineage = { ...(candidate as object), excerpt: id === 1 ? "// Licensed under the MIT License\nexport const x = 1;" : `export const value${id} = ${id};` };
        return admittedWith(lineage, { licenseSpdx: "MIT" });
      },
      generateProject: ({ candidates }) => {
        projectIds = candidates.map((candidate: any) => candidate.lineage.id);
        return { fixtures: Array(5).fill({ kind: "PROJECT" }) } as any;
      },
      collectStackMetadata: metadataFrom(stackRowsWith([
        { id: "py-leak", detectedLanguage: "Python" }, { id: "py-reject", detectedLanguage: "Python" }, { id: "py", detectedLanguage: "Python" },
      ])),
      revalidateStackCandidate: async ({ row }) => {
        const id = (row as any).id;
        return { value: { ...(row as object), path: `src/${id}.py`, repository: `owner/${id}`, excerpt: id === "py-leak" ? `# see src/${id}.py\nprint(1)` : "print(1)" },
          acceptedResponseHashes: ["8".repeat(64)] };
      },
    });

    await prepareLocalExperiment(harness.dependencies);

    expect(projectIds).not.toContain(1);
    expect(projectIds).toHaveLength(5);
    expect(harness.calls).toContain("eligible:py");
    // The leaky GitHub candidate is screened once for the project deck and once for the AI deck; the Stack row once.
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PUBLIC_CONTAINMENT_REJECTED", count: 3 });
  });

  it("keeps game and browser code out of the command and redacts top-level failures", async () => {
    const source = await readFile(sourcePath, "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*(?:apps\/game|next\/|playwright)|startGame|demo-game/u);
    expect(source).toMatch(/publishArtifact: async \(\{ artifact, expectedHash, beforeCommit \}\)[\s\S]*?targetPath: ARTIFACT_PATH, \.\.\.\(beforeCommit \? \{ beforeCommit \} : \{\}\)/u);
    const messages: string[] = [];
    const harness = await makeHarness({
      preflight: async () => { throw new Error("Bearer raw-secret account@example.test"); },
      log: (message) => { messages.push(message); },
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(messages.filter((message) => !message.startsWith("PREPARATION_FAILURE_SITE "))).toEqual(["PREPARATION_STAGE_FAILED PREFLIGHT UNCODED_ERROR none", "PREPARATION_FAILED"]);
    expect(messages.some((message) => /^PREPARATION_FAILURE_SITE [A-Za-z0-9_$.<>]+@[A-Za-z0-9_.-]+\.[cm]?[jt]sx?$/u.test(message))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/raw-secret|@example|Bearer/u);
  });
});
