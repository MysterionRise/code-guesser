import {
  count,
  deepFreeze,
  exact,
  fail,
  positiveCount,
  record,
  sha256,
  text,
  texts,
  type RecordValue,
} from "./model-validation";
import { SIGNED_CAPACITY_CEILINGS, STACK_LANGUAGES } from "./profile";

/** Revision 12: three decks of five fixtures. */
const EXPERIMENT_ROUND_COUNT = 15;
const RUN_COUNT_KEYS = [
  "requests", "githubPages", "githubResults", "repositoriesAdmitted", "stackRows",
  "blobAttempts", "blobsRetrieved", "githubRevalidations", "screened",
  "duplicatesRejected", "selected",
] as const;
const GITHUB_RESPONSE_STATES = new Set([
  "COMPLETE", "PROVIDER_REPORTED_INCOMPLETE", "NOT_STARTED",
]);
const STACK_RESPONSE_STATES = new Set(["COMPLETE", "INCOMPLETE", "NOT_STARTED"]);
const SUCCESSFUL_GITHUB_STATES = new Set(["COMPLETE", "PROVIDER_REPORTED_INCOMPLETE"]);
const MAX_RUN_RETRIES = 3;
const EXPERIMENT_SOURCE_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}:[^?#\r\n]+$/u;
const DIAGNOSTIC_STAGES = new Set([
  "DISCOVERY", "ADMISSION", "STACK_METADATA", "BLOB_RETRIEVAL",
  "GITHUB_REVALIDATION", "SCREENING", "DEDUPLICATION", "SELECTION",
]);

export interface RunRecord extends Readonly<RecordValue> {
  readonly outcome: "SUCCESS" | "FAILURE";
  readonly result: Readonly<RecordValue>;
}

const boundedCount = (value: unknown, maximum: number): number => {
  const parsed = count(value);
  return parsed <= maximum ? parsed : fail();
};

const validateExecutionIdentity = (value: unknown): void => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text(value))) fail();
};

const validateObservationTime = (value: unknown): void => {
  const parsed = text(value);
  if (Number.isNaN(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed) fail();
};

const validateCompleteness = (value: unknown, states: ReadonlySet<string>): string => {
  const parsed = text(value);
  return states.has(parsed) ? parsed : fail();
};

const parseRunQueries = (value: unknown): readonly RecordValue[] => {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const queries = value.map((entry) => {
    const query = record(entry, [
      "id", "role", "query", "sort", "order", "pageCeiling", "resultCeiling", "completeness",
    ]);
    text(query.id);
    if (query.role !== "ai-credit" && query.role !== "ordinary") fail();
    text(query.query);
    exact(query.sort, "committer-date");
    exact(query.order, "desc");
    boundedCount(query.pageCeiling, SIGNED_CAPACITY_CEILINGS.githubPages);
    boundedCount(query.resultCeiling, SIGNED_CAPACITY_CEILINGS.githubResults);
    validateCompleteness(query.completeness, GITHUB_RESPONSE_STATES);
    return query;
  });
  if (new Set(queries.map(({ id }) => id)).size !== queries.length) fail();
  return queries;
};

const parseRunConfigurations = (value: unknown): readonly RecordValue[] => {
  if (!Array.isArray(value) || value.length !== STACK_LANGUAGES.length) return fail();
  return value.map((entry, index) => {
    const configuration = record(entry, [
      "language", "configuration", "rowCeiling", "completeness",
    ]);
    exact(configuration.language, STACK_LANGUAGES[index]!);
    exact(configuration.configuration, STACK_LANGUAGES[index]!);
    boundedCount(configuration.rowCeiling, SIGNED_CAPACITY_CEILINGS.stackRowsPerLanguage);
    validateCompleteness(configuration.completeness, STACK_RESPONSE_STATES);
    return configuration;
  });
};

const validateRunUsage = (
  run: RecordValue,
  queries: readonly RecordValue[],
  configurations: readonly RecordValue[],
): number => {
  const sourceCapacity = queries.reduce((sum, query) => sum + count(query.resultCeiling), 0)
    + configurations.reduce((sum, configuration) => sum + count(configuration.rowCeiling), 0);
  const counts = record(run.counts, RUN_COUNT_KEYS);
  const requests = boundedCount(counts.requests, SIGNED_CAPACITY_CEILINGS.requestCount);
  boundedCount(counts.githubPages, queries.reduce((sum, query) => sum + count(query.pageCeiling), 0));
  boundedCount(counts.githubResults, queries.reduce((sum, query) => sum + count(query.resultCeiling), 0));
  boundedCount(counts.repositoriesAdmitted, sourceCapacity);
  const stackRows = record(counts.stackRows, STACK_LANGUAGES);
  STACK_LANGUAGES.forEach((language, index) =>
    boundedCount(stackRows[language], count(configurations[index]!.rowCeiling)));
  const attempts = boundedCount(counts.blobAttempts, SIGNED_CAPACITY_CEILINGS.blobAttempts);
  const retrieved = boundedCount(counts.blobsRetrieved, SIGNED_CAPACITY_CEILINGS.successfulBlobs);
  if (retrieved > attempts || count(counts.githubRevalidations) > attempts) fail();
  const screened = boundedCount(counts.screened, sourceCapacity);
  boundedCount(counts.duplicatesRejected, screened);
  boundedCount(counts.selected, Math.min(EXPERIMENT_ROUND_COUNT, screened));
  const bytes = record(run.bytes, ["githubResponses", "stackMetadata", "stackBlobs"]);
  boundedCount(bytes.githubResponses, requests * SIGNED_CAPACITY_CEILINGS.responseBytes);
  boundedCount(bytes.stackMetadata, SIGNED_CAPACITY_CEILINGS.stackMetadataBytes);
  boundedCount(bytes.stackBlobs, SIGNED_CAPACITY_CEILINGS.totalBlobBytes);
  const waits = record(run.waits, ["retries", "milliseconds"]);
  boundedCount(waits.retries, MAX_RUN_RETRIES);
  boundedCount(waits.milliseconds, SIGNED_CAPACITY_CEILINGS.totalWaitMilliseconds);
  return sourceCapacity;
};

const validateRunResult = (run: RecordValue, queries: readonly RecordValue[], configurations: readonly RecordValue[]): void => {
  if (run.outcome === "SUCCESS") {
    if (queries.some(({ completeness }) => !SUCCESSFUL_GITHUB_STATES.has(completeness as string))
      || configurations.some(({ completeness }) => completeness !== "COMPLETE")) fail();
    const counts = run.counts as RecordValue;
    if (counts.selected !== EXPERIMENT_ROUND_COUNT) fail();
    const result = record(run.result, ["artifactHash", "crawlSnapshotId", "sourceIdentities"]);
    sha256(result.artifactHash);
    sha256(result.crawlSnapshotId);
    const identities = texts(result.sourceIdentities);
    if (identities.length !== EXPERIMENT_ROUND_COUNT || identities.some((identity) => !EXPERIMENT_SOURCE_ID.test(identity))) fail();
    return;
  }
  exact(run.outcome, "FAILURE");
  const result = record(run.result, ["failedStage", "reasonCode"]);
  if (!DIAGNOSTIC_STAGES.has(text(result.failedStage))) fail();
  if (!/^[A-Z][A-Z0-9_]*$/u.test(text(result.reasonCode))) fail();
};

const validateDiagnostics = (value: unknown, maximum: number): void => {
  if (!Array.isArray(value)) return fail();
  let total = 0;
  for (const entry of value) {
    const item = record(entry, ["stage", "reasonCode", "count"]);
    if (!DIAGNOSTIC_STAGES.has(text(item.stage))) fail();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(text(item.reasonCode))) fail();
    total = boundedCount(total + positiveCount(item.count), maximum);
  }
};

export const parseRunRecord = (value: unknown): RunRecord => {
  const run = record(value, [
    "schemaVersion", "executionId", "observedAt", "profileVersion", "githubApiVersion",
    "stackRelease", "stackRevision", "githubQueries", "stackConfigurations", "counts",
    "bytes", "waits", "diagnostics", "outcome", "result",
  ]);
  exact(run.schemaVersion, "local-experiment-run.v2");
  validateExecutionIdentity(run.executionId);
  validateObservationTime(run.observedAt);
  for (const key of ["profileVersion", "githubApiVersion"]) text(run[key]);
  exact(run.stackRelease, "v2.2.0");
  exact(run.stackRevision, "e565caa3a78c2423bd374333a472b049eb090e47");
  const queries = parseRunQueries(run.githubQueries);
  const configurations = parseRunConfigurations(run.stackConfigurations);
  const outcomeCapacity = validateRunUsage(run, queries, configurations);
  validateDiagnostics(run.diagnostics, outcomeCapacity);
  validateRunResult(run, queries, configurations);
  return deepFreeze(structuredClone(run)) as RunRecord;
};
