import { ExperimentRecordError, parseExperimentArtifact } from "./model";
import { createRunReport, parseRunReport, RunReportError } from "./run-report";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const hash = (digit: string): string => digit.repeat(64);
const commit = (digit: string): string => digit.repeat(40);

const successReport = () => ({
  schemaVersion: "local-experiment-run.v2",
  executionId: "11111111-1111-4111-8111-111111111111",
  observedAt: "2026-07-31T12:00:00.000Z",
  profileVersion: "local-real-rounds.v2",
  githubApiVersion: "2022-11-28",
  stackRelease: "v2.2.0",
  stackRevision: "e565caa3a78c2423bd374333a472b049eb090e47",
  githubQueries: [{
    id: "copilot-trailer", role: "ai-credit", query: "\"Co-authored-by: GitHub Copilot\"",
    sort: "committer-date", order: "desc", pageCeiling: 3, resultCeiling: 300,
    completeness: "COMPLETE",
  }],
  stackConfigurations: [
    { language: "Python", configuration: "Python", rowCeiling: 10_000, completeness: "COMPLETE" },
    { language: "TypeScript", configuration: "TypeScript", rowCeiling: 10_000, completeness: "COMPLETE" },
    { language: "Go", configuration: "Go", rowCeiling: 10_000, completeness: "COMPLETE" },
    { language: "Rust", configuration: "Rust", rowCeiling: 10_000, completeness: "COMPLETE" },
    { language: "Ruby", configuration: "Ruby", rowCeiling: 10_000, completeness: "COMPLETE" },
  ],
  counts: {
    requests: 18, githubPages: 3, githubResults: 12, repositoriesAdmitted: 15,
    stackRows: { Python: 10, TypeScript: 10, Go: 10, Rust: 10, Ruby: 10 }, blobAttempts: 8, blobsRetrieved: 5,
    githubRevalidations: 5, screened: 16, duplicatesRejected: 1, selected: 15,
  },
  bytes: { githubResponses: 4096, stackMetadata: 8192, stackBlobs: 1024 },
  waits: { retries: 0, milliseconds: 0 },
  diagnostics: [{ stage: "SCREENING", reasonCode: "BINARY_CONTENT", count: 1 }],
  outcome: "SUCCESS",
  result: {
    artifactHash: hash("1"), crawlSnapshotId: hash("f"),
    sourceIdentities: Array.from({ length: 15 }, (_, index) => (index % 10).toString(16)).map((digit, index) =>
      `owner/project@${commit(digit)}:src/file-${index}.ts`),
  },
});

describe("operational run reports", () => {
  it("exposes a dedicated report parser outside the gameplay artifact model", async () => {
    const moduleName: string = "./run-report";
    const reportModule = await import(moduleName).catch(() => ({})) as Record<string, unknown>;

    expect(reportModule.parseRunReport).toBeTypeOf("function");
  });

  it("exposes a report producer and a non-sensitive rejection type", async () => {
    const moduleName: string = "./run-report";
    const reportModule = await import(moduleName) as Record<string, unknown>;

    expect(reportModule.createRunReport).toBeTypeOf("function");
    expect(reportModule.RunReportError).toBeTypeOf("function");
  });

  it("rejects sensitive values even when placed in otherwise allowed query fields", () => {
    const values = [
      "contact@example.com",
      "https://api.github.com/search/commits?q=secret",
      "Authorization: Bearer ghp_123456789",
      "X-Amz-Credential=AKIAEXAMPLE",
    ];

    for (const value of values) {
      const candidate = successReport();
      candidate.githubQueries[0]!.query = value;
      expect(() => createRunReport(candidate)).toThrow(RunReportError);
    }
  });

  it("produces exact recursively immutable success and failure reports", () => {
    const success = createRunReport(successReport());
    const failureInput = successReport() as Record<string, any>;
    failureInput.outcome = "FAILURE";
    failureInput.counts.selected = 2;
    failureInput.githubQueries[0].completeness = "NOT_STARTED";
    failureInput.result = { failedStage: "STACK_METADATA", reasonCode: "INCOMPLETE_RESPONSE" };
    const failure = parseRunReport(failureInput);

    expect(success.outcome).toBe("SUCCESS");
    expect(failure.outcome).toBe("FAILURE");
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(success.result)).toBe(true);
    expect(JSON.stringify(failure)).not.toMatch(/artifactHash|crawlSnapshotId|sourceIdentities/u);
  });

  it("accepts a revalidated blob that is later rejected by round eligibility", () => {
    const report = successReport();
    report.counts.blobAttempts = 6;
    report.counts.blobsRetrieved = 5;
    report.counts.githubRevalidations = 6;
    report.counts.screened = 17;
    report.diagnostics = [{ stage: "SCREENING", reasonCode: "LANGUAGE_ROUNDS_REJECTED", count: 1 }];

    expect(() => createRunReport(report)).not.toThrow();
  });

  it("rejects rows, source bodies, reveal material, extra fields, and gameplay import", () => {
    for (const field of ["row", "sourceExcerpt", "responseBody", "correctCandidateId", "evidence"]) {
      expect(() => createRunReport({ ...successReport(), [field]: "private" }))
        .toThrow(ExperimentRecordError);
    }
    expect(() => createRunReport({ ...successReport(), unexpected: true })).toThrow(ExperimentRecordError);
    expect(() => parseExperimentArtifact(createRunReport(successReport()))).toThrow(ExperimentRecordError);
  });
});
