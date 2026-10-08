import { ExperimentRecordError, parseRunRecord } from "./model";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const hash = (digit: string): string => digit.repeat(64);
const commit = (digit: string): string => digit.repeat(40);

const runRecord = () => ({
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
    requests: 18,
    githubPages: 3,
    githubResults: 12,
    repositoriesAdmitted: 15,
    stackRows: { Python: 10, TypeScript: 10, Go: 10, Rust: 10, Ruby: 10 },
    blobAttempts: 8,
    blobsRetrieved: 5,
    githubRevalidations: 5,
    screened: 16,
    duplicatesRejected: 1,
    selected: 15,
  },
  bytes: { githubResponses: 4096, stackMetadata: 8192, stackBlobs: 1024 },
  waits: { retries: 0, milliseconds: 0 },
  diagnostics: [{ stage: "SCREENING", reasonCode: "BINARY_CONTENT", count: 1 }],
  outcome: "SUCCESS",
  result: {
    artifactHash: hash("1"),
    crawlSnapshotId: hash("f"),
    sourceIdentities: Array.from({ length: 15 }, (_, index) => (index % 10).toString(16)).map((digit, index) =>
      `owner/project@${commit(digit)}:src/file-${index}.ts`),
  },
});

describe("operational run records", () => {
  it("parses a separate exact run record and rejects gameplay fixture material", () => {
    const run = parseRunRecord(runRecord());

    expect(run.outcome).toBe("SUCCESS");
    expect(() => parseRunRecord({ ...run, fixtures: [] })).toThrow(ExperimentRecordError);
  });

  it("rejects incomplete run counters and malformed diagnostic summaries", () => {
    const missingCounter = runRecord() as Record<string, any>;
    delete missingCounter.counts.githubPages;
    const invalidStage = runRecord();
    invalidStage.diagnostics[0]!.stage = "PRIVATE_BODY";
    const invalidReason = runRecord();
    invalidReason.diagnostics[0]!.reasonCode = "contains private detail";
    const invalidCount = runRecord();
    invalidCount.diagnostics[0]!.count = 0;

    for (const candidate of [missingCounter, invalidStage, invalidReason, invalidCount]) {
      expect(() => parseRunRecord(candidate)).toThrow(ExperimentRecordError);
    }
  });

  it("requires exact complete query, configuration, byte, and successful result records", () => {
    const tooFew = runRecord();
    tooFew.result.sourceIdentities.pop();
    const duplicate = runRecord();
    duplicate.result.sourceIdentities[4] = duplicate.result.sourceIdentities[0]!;
    const notStarted = runRecord();
    notStarted.githubQueries[0]!.completeness = "NOT_STARTED";
    const missingBytes = runRecord() as Record<string, any>;
    delete missingBytes.bytes.stackMetadata;

    for (const candidate of [tooFew, duplicate, notStarted, missingBytes]) {
      expect(() => parseRunRecord(candidate)).toThrow(ExperimentRecordError);
    }
  });

  it("accepts provider-reported incomplete GitHub discovery in a successful run", () => {
    const run = runRecord();
    run.githubQueries[0]!.completeness = "PROVIDER_REPORTED_INCOMPLETE";

    expect(parseRunRecord(run)).toMatchObject({
      githubQueries: [{ completeness: "PROVIDER_REPORTED_INCOMPLETE" }],
    });
  });

  it("rejects legacy and unsupported GitHub completeness states", () => {
    for (const completeness of ["INCOMPLETE", "PARTIAL"]) {
      const failed = runRecord() as Record<string, any>;
      failed.outcome = "FAILURE";
      failed.githubQueries[0].completeness = completeness;
      failed.counts.selected = 2;
      failed.result = { failedStage: "DISCOVERY", reasonCode: "SEARCH_REJECTED" };

      expect(() => parseRunRecord(failed)).toThrow(ExperimentRecordError);
    }
  });

  it("requires complete Stack configurations for a successful run", () => {
    const run = runRecord();
    run.githubQueries[0]!.completeness = "PROVIDER_REPORTED_INCOMPLETE";
    run.stackConfigurations[0]!.completeness = "INCOMPLETE";

    expect(() => parseRunRecord(run)).toThrow(ExperimentRecordError);
  });

  it("accepts a bounded failure record without invented artifact or source identities", () => {
    const failed = runRecord() as Record<string, any>;
    failed.outcome = "FAILURE";
    failed.githubQueries[0].completeness = "NOT_STARTED";
    failed.counts.selected = 2;
    failed.result = { failedStage: "STACK_METADATA", reasonCode: "INCOMPLETE_RESPONSE" };

    const parsed = parseRunRecord(failed);

    expect(parsed.outcome).toBe("FAILURE");
    expect(JSON.stringify(parsed)).not.toMatch(/artifactHash|crawlSnapshotId|sourceIdentities/u);
  });

  it("rejects malformed identities, response states, inconsistent counts, and first over-ceiling values", () => {
    const mutations: Array<(candidate: ReturnType<typeof runRecord>) => void> = [
      (candidate) => { candidate.executionId = "predictable"; },
      (candidate) => { candidate.observedAt = "yesterday"; },
      (candidate) => { candidate.githubQueries[0]!.pageCeiling = 4; },
      (candidate) => { candidate.githubQueries[0]!.resultCeiling = 301; },
      (candidate) => { candidate.stackConfigurations[0]!.rowCeiling = 10_001; },
      (candidate) => { candidate.counts.githubPages = 4; },
      (candidate) => { candidate.counts.stackRows.Python = 10_001; },
      (candidate) => { candidate.counts.blobAttempts = 51; },
      (candidate) => { candidate.counts.blobsRetrieved = 9; },
      (candidate) => { candidate.bytes.stackMetadata = 96 * 1024 * 1024 + 1; },
      (candidate) => { candidate.bytes.stackBlobs = 16 * 1024 * 1024 + 1; },
      (candidate) => { candidate.waits.retries = 4; },
      (candidate) => { candidate.waits.milliseconds = 30_001; },
      (candidate) => { candidate.counts.selected = 14; },
      (candidate) => { candidate.counts.requests = 601; },
    ];

    for (const mutate of mutations) {
      const candidate = runRecord();
      mutate(candidate);
      expect(() => parseRunRecord(candidate)).toThrow(ExperimentRecordError);
    }
  });

  it("bounds operational outcomes by the recorded source capacities and screening relationships", () => {
    const sourceCapacity = 300 + 5 * 10_000;
    const mutations: Array<(candidate: ReturnType<typeof runRecord>) => void> = [
      (candidate) => { candidate.counts.repositoriesAdmitted = sourceCapacity + 1; },
      (candidate) => { candidate.counts.screened = sourceCapacity + 1; },
      (candidate) => { candidate.counts.duplicatesRejected = candidate.counts.screened + 1; },
      (candidate) => { candidate.counts.screened = candidate.counts.selected - 1; },
      (candidate) => { candidate.diagnostics[0]!.count = sourceCapacity + 1; },
      (candidate) => {
        candidate.diagnostics[0]!.count = 25_200;
        candidate.diagnostics.push({ stage: "ADMISSION", reasonCode: "NOT_ELIGIBLE", count: 25_101 });
      },
    ];

    for (const mutate of mutations) {
      const candidate = runRecord();
      mutate(candidate);
      expect(() => parseRunRecord(candidate)).toThrow(ExperimentRecordError);
    }
  });
});
