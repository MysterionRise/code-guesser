import { readFile } from "node:fs/promises";

import { canonicalHash } from "./canonical";
import { createCapacityMeter } from "./capacity";
import { accepted, classificationsFor, hash, loadProfile, makeHarness } from "./command-test-harness";
import { createRunReport } from "./run-report";
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
const searchWith = (queryClassifications: unknown): PreparationDependencies["searchGitHub"] => async () => accepted({
  candidates: [0, 1, 2, 3, 4].map((id) => ({ id })),
  queryClassifications,
} as any, "2");

describe("local experiment preparation command", () => {
  it("exposes one preparation entry point and one no-argument project command", async () => {
    expect(prepareLocalExperiment).toBeTypeOf("function");
    expect(runPreparationCli).toBeTypeOf("function");
    const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(manifest.scripts["prepare:poc"]).toBe("node --import tsx ops/poc/prepare/index.ts");
  });

  it("runs preflight first, both mandatory lanes, exact 3/2 composition, report, then publication", async () => {
    const harness = await makeHarness();
    const result = await prepareLocalExperiment(harness.dependencies) as PreparationResult;

    expect(harness.calls.indexOf("preflight")).toBeLessThan(harness.calls.indexOf("search"));
    expect(harness.calls.indexOf("preflight")).toBeLessThan(harness.calls.indexOf("metadata:Python"));
    expect(harness.calls).toContain("metadata:TypeScript");
    expect(harness.calls).toContain("provenance:3");
    expect(harness.calls).toContain("language:2");
    expect(harness.calls).toContain("compose:3/2");
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
      "fetch:py-reject:50:16777216",
      "fetch:py:49:16777136",
      "fetch:ts:48:16777056",
    ]);
    expect(harness.calls.filter((call) => call.startsWith("eligible:"))).toEqual([
      "eligible:py-reject", "eligible:py", "eligible:ts",
    ]);
    expect(harness.leases).toEqual([
      { accepted: false, released: true, bytes: 80 },
      { accepted: true, released: false, bytes: 80 },
      { accepted: true, released: false, bytes: 80 },
    ]);
  });

  it("continues GitHub rejection until three candidates include both marker outcomes", async () => {
    const rejected: number[] = [];
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        const id = (candidate as any).id as number;
        if (id === 1) { rejected.push(id); throw new Error("REPOSITORY_REJECTED"); }
        return accepted({ admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage: candidate }, "4");
      },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(rejected).toEqual([1]);
    expect(harness.calls).toContain("lineage:3");
    expect(harness.calls).not.toContain("lineage:4");
  });

  it("selects an exact stable three after leading candidates share one marker outcome", async () => {
    const visited: number[] = [];
    const profile = await loadProfile();
    const harness = await makeHarness({
      bindGitHubLineage: async ({ candidate }) => {
        const id = (candidate as any).id as number;
        visited.push(id);
        return accepted({ ...(candidate as object), commitMessage: id < 3 ? profile.markers[0] : "ordinary refactor" }, "3");
      },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(visited).toEqual([0, 1, 2, 3]);
    expect(harness.calls).toContain("provenance:3");
  });

  it("rejects duplicate admitted provenance and continues to a unique replacement", async () => {
    const visited: number[] = [];
    const duplicateHash = hash("d");
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        const id = (candidate as any).id as number;
        visited.push(id);
        return accepted({ admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage: candidate,
          source: { repository: `github/${id}`, commit: String(id + 1).repeat(40), path: `src/${id}.ts`,
            blob: String(id + 2).repeat(40), rawContentHash: id < 2 ? duplicateHash : hash(String(id + 1)),
            excerptHash: hash(String(id + 5)) } }, "4");
      },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(visited).toEqual([0, 1, 2, 3]);
    expect((harness.reports[0] as any).diagnostics).toContainEqual(
      { stage: "DEDUPLICATION", reasonCode: "SOURCE_DUPLICATE", count: 1 },
    );
  });

  it("orders Stack candidates by the profile keys and continues after cross-source deduplication", async () => {
    const collisionHash = hash("c");
    const stackRows = {
      Python: [
        { id: "late", detectedLanguage: "Python", stableRowId: hash("2"), repository: "stack/late",
          swhRevisionId: "2".repeat(40), path: "late.py", swhContentId: "2".repeat(40), rawContentHash: hash("d") },
        { id: "collision", detectedLanguage: "Python", stableRowId: hash("1"), repository: "stack/collision",
          swhRevisionId: "1".repeat(40), path: "collision.py", swhContentId: "1".repeat(40), rawContentHash: collisionHash },
      ],
      TypeScript: [{ id: "ts", detectedLanguage: "TypeScript", stableRowId: hash("3"), repository: "stack/ts",
        swhRevisionId: "3".repeat(40), path: "round.ts", swhContentId: "3".repeat(40), rawContentHash: hash("e") }],
    } as const;
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => accepted({
        admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage: candidate,
        source: { repository: `github/${(candidate as any).id}`, commit: String((candidate as any).id + 1).repeat(40),
          path: `src/round-${(candidate as any).id}.ts`, blob: String((candidate as any).id + 2).repeat(40),
          rawContentHash: (candidate as any).id === 0 ? collisionHash : hash(String((candidate as any).id + 3)),
          excerptHash: hash(String((candidate as any).id + 6)) },
      }, "4"),
      collectStackMetadata: async ({ configuration, capacity }) => {
        capacity.recordStackRows(configuration, stackRows[configuration].length, 100);
        return accepted(stackRows[configuration], configuration === "Python" ? "5" : "6");
      },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("fetch:"))).toEqual([
      "fetch:collision:50:16777216", "fetch:late:49:16777136", "fetch:ts:48:16777056",
    ]);
    expect(harness.leases[0]).toMatchObject({ accepted: false, released: true });
  });

  it("continues after an independently duplicated Stack language candidate", async () => {
    const duplicateHash = hash("d");
    const rows = {
      Python: [{ id: "py", detectedLanguage: "Python", stableRowId: hash("1"), repository: "stack/py",
        swhRevisionId: "1".repeat(40), path: "round.py", swhContentId: "1".repeat(40), rawContentHash: duplicateHash }],
      TypeScript: [
        { id: "ts-late", detectedLanguage: "TypeScript", stableRowId: hash("3"), repository: "stack/late",
          swhRevisionId: "3".repeat(40), path: "late.ts", swhContentId: "3".repeat(40), rawContentHash: hash("e") },
        { id: "ts-duplicate", detectedLanguage: "TypeScript", stableRowId: hash("2"), repository: "stack/duplicate",
          swhRevisionId: "2".repeat(40), path: "duplicate.ts", swhContentId: "2".repeat(40), rawContentHash: duplicateHash },
      ],
    } as const;
    const harness = await makeHarness({
      collectStackMetadata: async ({ configuration, capacity }) => {
        capacity.recordStackRows(configuration, rows[configuration].length, 100);
        return accepted(rows[configuration], configuration === "Python" ? "5" : "6");
      },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("fetch:"))).toEqual([
      "fetch:py:50:16777216", "fetch:ts-duplicate:49:16777136", "fetch:ts-late:48:16777056",
    ]);
    expect(harness.leases[1]).toMatchObject({ accepted: false, released: true });
  });

  it("never publishes on insufficient selection, composition, or report failure", async () => {
    const failures: Partial<PreparationDependencies>[] = [
      { collectStackMetadata: async ({ configuration }) => accepted(configuration === "Python" ? [] : [], "5") },
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
      repositoriesAdmitted: 3, blobAttempts: 3, blobsRetrieved: 2,
      githubRevalidations: 3, screened: 6, duplicatesRejected: 0, selected: 5,
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

    expect(harness.calls.filter((call) => call.startsWith("log:"))).toEqual([
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

    expect(harness.calls.filter((call) => call.startsWith("log:"))).toEqual([
      "log:PREPARATION_COMPLETE",
    ]);
  });

  it("fails closed on malformed injected query classifications", async () => {
    const profile = await loadProfile();
    const valid = classificationsFor(profile);
    const malformed = [
      ["missing", valid.slice(0, -1)],
      ["extra", [...valid, { queryId: "extra", completeness: "COMPLETE" }]],
      ["misordered", [valid[1], valid[0], valid[2]]],
      ["mismatched", [{ ...valid[0], queryId: "wrong" }, valid[1], valid[2]]],
      ["duplicate", [valid[0], valid[0], valid[2]]],
      ["unsupported", [{ ...valid[0], completeness: "INCOMPLETE" }, valid[1], valid[2]]],
    ] as const;

    for (const [_label, classifications] of malformed) {
      const harness = await makeHarness({ searchGitHub: searchWith(classifications) });
      await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
      expect(harness.calls.filter((call) => call.startsWith("log:"))).toEqual(["log:PREPARATION_FAILED"]);
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

    expect(harness.calls.filter((call) => call.startsWith("log:"))).toEqual([
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
    expect(harness.calls.filter((call) => call.startsWith("log:"))).toEqual(["log:PREPARATION_FAILED"]);
  });

  it("replays captured responses in order without a second live request", async () => {
    const command = await import("./index") as Record<string, any>;
    const profile = await loadProfile();
    const capacity = createCapacityMeter({ limits: profile.capacity,
      githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: ["Python", "TypeScript"] });
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
      compose: (options) => ({ artifact: { crawlSnapshot: { id: hash("e") },
        fixtures: [...options.provenance.fixtures, ...options.language.fixtures].map((fixture, index) => ({
          ...fixture, source: { repository: `owner/repo-${index}`, commit: String(index + 1).repeat(40), path: `src/file-${index}.ts` },
        })) }, artifactHash: hash("9"), artifactBytes: new Uint8Array([1]), roundRecordSet: {} } as any),
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.published).toEqual([]);
  });

  it("rejects replay-finalized source bindings that do not use the captured snapshot", async () => {
    const harness = await makeHarness({
      finalizeBindings: async ({ provenanceCandidates, languageSelections }) => ({
        provenanceCandidates: provenanceCandidates.map((candidate: any) => ({ ...candidate,
          source: { ...(candidate.source ?? {}), crawlSnapshotId: hash("e") } })),
        languageCandidates: languageSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId: hash("e") })),
      }),
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.published).toEqual([]);
  });

  it("binds replayed sources, composition, report, publication, and result to one captured snapshot", async () => {
    let finalizedId = "";
    const harness = await makeHarness({
      finalizeBindings: async ({ crawlSnapshotId, provenanceCandidates, languageSelections }) => {
        finalizedId = crawlSnapshotId;
        return {
          provenanceCandidates: provenanceCandidates.map((candidate: any) => ({ ...candidate,
            source: { ...(candidate.source ?? {}), crawlSnapshotId } })),
          languageCandidates: languageSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId })),
        };
      },
    });
    const profile = await loadProfile();
    const acceptedResponseHashes = ["1", "2", "3", "4", "5", "6", "7", "8"].map(hash);
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
    expect(messages).toEqual(["PREPARATION_FAILED"]);
    expect(messages.join(" ")).not.toMatch(/raw-secret|@example/u);
  });
});
