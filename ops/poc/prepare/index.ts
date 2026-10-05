import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishArtifact } from "./artifact-store";
import { canonicalBytes, canonicalHash } from "./canonical";
import { createCapacityMeter, type CapacityMeter, type CapacitySnapshot } from "./capacity";
import { composeExperimentArtifact, type ComposedExperiment } from "./compose";
import { admitGitHubCandidates } from "./github-admission";
import { bindGitHubLineage } from "./github-lineage";
import { crawlGitHubCommitSearch, type GitHubQueryClassification } from "./github-search";
import { generateLanguageRounds, validateLanguageCandidate, type GeneratedLanguageRounds } from "./language-rounds";
import { parseCrawlProfile, type CrawlProfile } from "./profile";
import { generateProvenanceRounds, type GeneratedProvenanceRounds } from "./provenance-rounds";
import { createRetryController, type RetryController } from "./retry";
import { stageRunReport, type StagedRunReport } from "./report-store";
import { createRunReport } from "./run-report";
import { preflightStackAccess } from "./stack-access";
import { collectStackMetadata, type StackMetadataRow } from "./stack-metadata";
import { revalidateStackCandidate, type SelectedStackBlob } from "./stack-revalidation";
import { createBoundedTransport, type BoundedTransport } from "./transport";
import type { RequestInput } from "./request-policy";
type Environment = Readonly<Record<string, string | undefined>>;
type StageResult<Value> = Readonly<{ value: Value; acceptedResponseHashes: readonly string[] }>;
type Context = Readonly<{ profile: CrawlProfile; canonicalProfileBytes: Uint8Array; profileHash: string; environment: Environment; capacity: CapacityMeter; runtime: unknown }>;
type StackSelection = Readonly<{ row: unknown; blob: unknown; candidate: unknown }>;
type DiagnosticStage = "DISCOVERY" | "ADMISSION" | "BLOB_RETRIEVAL" | "GITHUB_REVALIDATION" | "SCREENING" | "DEDUPLICATION";
interface RunState { readonly diagnostics: Map<string, number>; repositoriesAdmitted: number; githubRevalidations: number; screened: number; duplicatesRejected: number }
export interface PreparationDependencies {
  loadProfile(): Promise<Readonly<{ profile: CrawlProfile; canonicalProfileBytes: Uint8Array }>>; environment(): Environment;
  createCapacity(options: Parameters<typeof createCapacityMeter>[0]): CapacityMeter; createRuntime(options: Readonly<{ profile: CrawlProfile; environment: Environment; capacity: CapacityMeter }>): unknown;
  preflight(options: Context): Promise<StageResult<unknown>>; searchGitHub(options: Context): Promise<StageResult<Readonly<{ candidates: readonly unknown[]; queryClassifications: readonly GitHubQueryClassification[] }>>>;
  bindGitHubLineage(options: Context & Readonly<{ candidate: unknown }>): Promise<StageResult<unknown>>; admitGitHubCandidate(options: Context & Readonly<{ candidate: unknown; crawlSnapshotId: string }>): Promise<StageResult<unknown>>;
  collectStackMetadata(options: Context & Readonly<{ configuration: "Python" | "TypeScript" }>): Promise<StageResult<readonly unknown[]>>; fetchStackBlob(options: Context & Readonly<{ row: unknown; limits: BlobLimits }>): Promise<StageResult<Readonly<{ byteLength: number }>>>;
  revalidateStackCandidate(options: Context & Readonly<{ row: unknown; blob: unknown; crawlSnapshotId: string }>): Promise<StageResult<unknown>>;
  validateLanguageCandidate(options: Context & Readonly<{ candidate: unknown }>): unknown; finalizeBindings?(options: Context & Readonly<{ crawlSnapshotId: string; provenanceCandidates: readonly unknown[]; languageSelections: readonly StackSelection[] }>): Promise<Readonly<{ provenanceCandidates: readonly unknown[]; languageCandidates: readonly unknown[] }>>;
  generateProvenance(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedProvenanceRounds; generateLanguage(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedLanguageRounds;
  compose(options: Parameters<typeof composeExperimentArtifact>[0]): ComposedExperiment; createReport(input: Readonly<Record<string, unknown>>): unknown;
  stageReport(report: unknown): Promise<StagedRunReport>; publishArtifact(input: Readonly<{ artifact: unknown; expectedHash: string; beforeCommit?: () => Promise<void> }>): Promise<unknown>;
  now(): Date; uuid(): string; log(message: string): void; }
interface BlobLimits { readonly blobAttempts: number; readonly successfulBlobs: number; readonly perBlobBytes: number; readonly totalBlobBytes: number; readonly temporaryDiskBytes: number }
export interface PreparationResult { readonly artifactHash: string; readonly crawlSnapshotId: string; readonly publication: unknown }
export class PreparationError extends Error { public constructor() { super("PREPARATION_FAILED"); this.name = "PreparationError"; } }
const PROFILE_URL = new URL("../profiles/local-real-rounds.v1.json", import.meta.url); const ARTIFACT_PATH = fileURLToPath(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url));
const REPORT_PATH = fileURLToPath(new URL("../stack/tmp/local-experiment-run.json", import.meta.url)); const SHA256 = /^[0-9a-f]{64}$/u;
const projectEnvironment = (source: Environment, keys: readonly string[]): Environment => Object.freeze(Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])));
export const projectPreparationEnvironment = (source: Environment): Environment => projectEnvironment(source, ["PATH", "HOME", "HF_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "STACK_V2_ACKNOWLEDGED_USABLE_REVISION"]);
export const projectBlobWorkerEnvironment = (source: Environment): Environment => projectEnvironment(source, ["PATH", "HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE"]);
const addHashes = (target: string[], values: readonly string[]): void => { for (const value of values) {
  if (!SHA256.test(value)) throw new PreparationError(); if (!target.includes(value)) target.push(value);
} };
const QUERY_COMPLETENESS = new Set(["COMPLETE", "PROVIDER_REPORTED_INCOMPLETE"]);
const validateClassifications = (profile: CrawlProfile, values: unknown): readonly GitHubQueryClassification[] => {
  if (!Array.isArray(values) || values.length !== profile.github.queries.length) throw new PreparationError(); const seen = new Set<string>();
  for (const [index, value] of values.entries()) { if (typeof value !== "object" || value === null) throw new PreparationError();
    const { queryId, completeness } = value as Record<string, unknown>;
    if (queryId !== profile.github.queries[index]!.id || seen.has(queryId) || !QUERY_COMPLETENESS.has(completeness as string)) throw new PreparationError();
    seen.add(queryId); }
  return values as readonly GitHubQueryClassification[];
};
const noteRejection = (state: RunState, stage: DiagnosticStage, error: unknown): void => { const message = error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message) ? error.message : "CANDIDATE_REJECTED";
  const key = `${stage}\0${message}`; state.diagnostics.set(key, (state.diagnostics.get(key) ?? 0) + 1);
};
const markerOutcome = (candidate: unknown, profile: CrawlProfile): boolean => String((candidate as any).lineage?.commitMessage ?? (candidate as any).commitMessage ?? "").split(/\r?\n/u).some((line) => profile.markers.includes(line));
const provisionalSnapshot = (profileHash: string, hashes: readonly string[]): string => canonicalHash({ profileHash, acceptedResponseHashes: hashes.length > 0 ? hashes : [canonicalHash("capture")] });
const remainingBlobLimits = (profile: CrawlProfile, snapshot: CapacitySnapshot): BlobLimits => Object.freeze({
  blobAttempts: Math.max(1, profile.capacity.blobAttempts - snapshot.blobAttempts + 1), successfulBlobs: Math.max(1, profile.capacity.successfulBlobs - snapshot.successfulBlobs), perBlobBytes: profile.capacity.perBlobBytes, totalBlobBytes: Math.max(1, profile.capacity.totalBlobBytes - snapshot.totalBlobBytes), temporaryDiskBytes: Math.max(1, profile.capacity.temporaryDiskBytes - snapshot.temporaryDiskBytes) });
const stackOrder = (left: any, right: any): number => {
  for (const key of ["stableRowId", "repository", "swhRevisionId", "path", "swhContentId"]) {
    const order = String(left[key]) < String(right[key]) ? -1 : String(left[key]) > String(right[key]) ? 1 : 0;
    if (order !== 0) return order;
  } return 0; };
const collidesWithSelected = (profile: CrawlProfile, candidate: any, selected: readonly unknown[]): boolean => { const source = candidate.source ?? candidate;
  return profile.deduplication.some((key) => selected.some((value: any) => typeof source[key] === "string" && source[key] === (value.source ?? value)[key])); };
const selectGitHub = async (context: Context, deps: PreparationDependencies, hashes: string[], pool: readonly unknown[], state: RunState) => {
  const selected: unknown[] = []; const outcomes = new Set<boolean>();
  for (const candidate of pool) {
    let lineage: StageResult<unknown>;
    try { lineage = await deps.bindGitHubLineage({ ...context, candidate }); addHashes(hashes, lineage.acceptedResponseHashes);
    } catch (error) { noteRejection(state, "DISCOVERY", error); continue; }
    try {
      const admitted = await deps.admitGitHubCandidate({ ...context, candidate: lineage.value, crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
      addHashes(hashes, admitted.acceptedResponseHashes);
      state.repositoriesAdmitted += 1; state.screened += 1;
      if (collidesWithSelected(context.profile, admitted.value, selected)) { state.duplicatesRejected += 1; noteRejection(state, "DEDUPLICATION", new Error("SOURCE_DUPLICATE")); continue; }
      selected.push(admitted.value);
      outcomes.add(markerOutcome(admitted.value, context.profile)); if (selected.length >= 3 && outcomes.size === 2) break;
    } catch (error) { noteRejection(state, "ADMISSION", error); }
  }
  if (selected.length < 3 || outcomes.size !== 2) throw new PreparationError();
  const required = new Set([selected.findIndex((value) => markerOutcome(value, context.profile)), selected.findIndex((value) => !markerOutcome(value, context.profile))]);
  for (let index = 0; required.size < 3; index += 1) required.add(index);
  return Object.freeze(selected.filter((_value, index) => required.has(index)));
};
const selectStack = async (context: Context, deps: PreparationDependencies, hashes: string[], rows: readonly unknown[], provenance: readonly unknown[], state: RunState) => {
  const selected: StackSelection[] = [];
  for (const configuration of context.profile.stack.configurations) {
    const ordered = rows.filter((item) => (item as any).detectedLanguage === configuration.language).sort(stackOrder);
    for (const row of ordered) {
      const lease = context.capacity.beginBlob();
      let stage: DiagnosticStage = "BLOB_RETRIEVAL";
      try {
        const fetched = await deps.fetchStackBlob({ ...context, row,
          limits: remainingBlobLimits(context.profile, context.capacity.snapshot()) });
        addHashes(hashes, fetched.acceptedResponseHashes);
        lease.addBytes(fetched.value.byteLength);
        stage = "GITHUB_REVALIDATION";
        const checked = await deps.revalidateStackCandidate({ ...context, row, blob: fetched.value,
          crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
        addHashes(hashes, checked.acceptedResponseHashes); state.githubRevalidations += 1;
        if ((checked.value as any).detectedLanguage !== configuration.language) throw new PreparationError();
        stage = "SCREENING"; state.screened += 1;
        const eligible = deps.validateLanguageCandidate({ ...context, candidate: checked.value });
        stage = "DEDUPLICATION";
        if (collidesWithSelected(context.profile, eligible, [...provenance, ...selected.map(({ candidate }) => candidate)])) { state.duplicatesRejected += 1; throw new Error("SOURCE_DUPLICATE"); }
        lease.accept();
        selected.push(Object.freeze({ row, blob: fetched.value, candidate: eligible }));
        break;
      } catch (error) { noteRejection(state, stage, error); lease.release(); }
    }
  }
  if (selected.length !== 2) throw new PreparationError();
  return Object.freeze(selected);
};
const reportInput = (context: Context, composed: ComposedExperiment, executionId: string, observedAt: string, state: RunState, classifications: readonly GitHubQueryClassification[]) => {
  const snapshot = context.capacity.snapshot();
  const github = Object.values(snapshot.github);
  const sources = (composed.artifact.fixtures as any[]).map(({ source }) => `${source.repository}@${source.commit}:${source.path}`);
  return {
    schemaVersion: "local-experiment-run.v1", executionId, observedAt, profileVersion: context.profile.profileVersion, githubApiVersion: context.profile.github.apiVersion,
    stackRelease: context.profile.stack.release, stackRevision: context.profile.stack.revision,
    githubQueries: context.profile.github.queries.map((query, index) => ({ ...query, pageCeiling: context.profile.capacity.githubPages, resultCeiling: context.profile.capacity.githubResults, completeness: classifications[index]!.completeness })),
    stackConfigurations: context.profile.stack.configurations.map(({ language, configuration }) => ({ language, configuration, rowCeiling: context.profile.capacity.stackRowsPerLanguage, completeness: "COMPLETE" })),
    counts: { requests: snapshot.requestCount, githubPages: github.reduce((n, value) => n + value.pages, 0),
      githubResults: github.reduce((n, value) => n + value.results, 0), repositoriesAdmitted: state.repositoriesAdmitted,
      stackRows: snapshot.stackRows, blobAttempts: snapshot.blobAttempts, blobsRetrieved: snapshot.successfulBlobs,
      githubRevalidations: state.githubRevalidations, screened: state.screened, duplicatesRejected: state.duplicatesRejected, selected: 5 },
    bytes: { githubResponses: snapshot.responseBytes, stackMetadata: snapshot.stackMetadataBytes, stackBlobs: snapshot.totalBlobBytes },
    waits: { retries: snapshot.retryWaits, milliseconds: snapshot.waitedMilliseconds },
    diagnostics: [...state.diagnostics].map(([key, count]) => { const [stage, reasonCode] = key.split("\0"); return { stage, reasonCode, count }; }), outcome: "SUCCESS", result: { artifactHash: composed.artifactHash, crawlSnapshotId: composed.artifact.crawlSnapshot.id, sourceIdentities: sources },
  };
};
export const prepareLocalExperiment = async (deps: PreparationDependencies = defaultDependencies()): Promise<PreparationResult> => {
  try {
    const loaded = await deps.loadProfile();
    const profileHash = canonicalHash(loaded.profile);
    if (canonicalHash(JSON.parse(new TextDecoder().decode(loaded.canonicalProfileBytes))) !== profileHash) throw new PreparationError();
    const environment = deps.environment();
    const capacity = deps.createCapacity({ limits: loaded.profile.capacity,
      githubQueryIds: loaded.profile.github.queries.map(({ id }) => id), stackLanguages: ["Python", "TypeScript"] });
    const runtime = deps.createRuntime({ profile: loaded.profile, environment, capacity });
    const context = Object.freeze({ ...loaded, profileHash, environment, capacity, runtime });
    const hashes: string[] = [];
    const state: RunState = { diagnostics: new Map(), repositoriesAdmitted: 0, githubRevalidations: 0, screened: 0, duplicatesRejected: 0 };
    addHashes(hashes, (await deps.preflight(context)).acceptedResponseHashes);
    const search = await deps.searchGitHub(context); addHashes(hashes, search.acceptedResponseHashes);
    const classifications = validateClassifications(loaded.profile, search.value.queryClassifications);
    const provenanceCandidates = await selectGitHub(context, deps, hashes, search.value.candidates, state);
    const metadata: unknown[] = [];
    for (const { configuration } of loaded.profile.stack.configurations) {
      const result = await deps.collectStackMetadata({ ...context, configuration });
      addHashes(hashes, result.acceptedResponseHashes); metadata.push(...result.value);
    }
    const languageSelections = await selectStack(context, deps, hashes, metadata, provenanceCandidates, state);
    const crawlSnapshotId = provisionalSnapshot(profileHash, hashes);
    const finalized = deps.finalizeBindings
      ? await deps.finalizeBindings({ ...context, crawlSnapshotId, provenanceCandidates, languageSelections })
      : { provenanceCandidates, languageCandidates: languageSelections.map(({ candidate }) => candidate) };
    if (deps.finalizeBindings && (finalized.provenanceCandidates.some((candidate: any) => candidate.source?.crawlSnapshotId !== crawlSnapshotId)
      || finalized.languageCandidates.some((candidate: any) => candidate.crawlSnapshotId !== crawlSnapshotId))) throw new PreparationError();
    const provenance = deps.generateProvenance({ profile: loaded.profile, candidates: finalized.provenanceCandidates });
    const language = deps.generateLanguage({ profile: loaded.profile, candidates: finalized.languageCandidates });
    if (provenance.fixtures.length !== 3 || language.fixtures.length !== 2) throw new PreparationError();
    const composed = deps.compose({ profile: loaded.profile, canonicalProfileBytes: loaded.canonicalProfileBytes,
      acceptedResponseHashes: Object.freeze(hashes), provenance, language });
    if (composed.artifact.crawlSnapshot.id !== crawlSnapshotId) throw new PreparationError();
    const report = deps.createReport(reportInput(context, composed, deps.uuid(), deps.now().toISOString(), state, classifications));
    const publication = await publishWithReport(deps, composed, report);
    if (classifications.some(({ completeness }) => completeness === "PROVIDER_REPORTED_INCOMPLETE")) deps.log("GITHUB_SEARCH_INCOMPLETE");
    deps.log("PREPARATION_COMPLETE");
    return Object.freeze({ artifactHash: composed.artifactHash, crawlSnapshotId, publication });
  } catch { deps.log("PREPARATION_FAILED"); throw new PreparationError(); }
};
interface Runtime { readonly capacity: CapacityMeter; transport: BoundedTransport; readonly retry: RetryController; readonly environment: Environment; readonly responses: Map<string, unknown[]>; readonly hashes: string[]; readonly replayCursors: Map<string, number>; replay: boolean; beginReplay(): void }
const runtimeOf = (context: Context): Runtime => context.runtime as Runtime;
const stage = async <Value>(runtime: Runtime, operation: () => Promise<Value>): Promise<StageResult<Value>> => {
  const offset = runtime.hashes.length; const value = await operation();
  return Object.freeze({ value, acceptedResponseHashes: Object.freeze(runtime.hashes.slice(offset)) });
};
const workerStage = async <Value>(operation: () => Promise<Value>): Promise<StageResult<Value>> => { const value = await operation(); return Object.freeze({ value, acceptedResponseHashes: Object.freeze([canonicalHash(value)]) }); };
const responseKey = (request: { provider: string; method: string; url: string }): string => `${request.provider}\0${request.method}\0${request.url}`;
export const createPreparationRuntime = (profile: CrawlProfile, environment: Environment, capacity: CapacityMeter, fetchLike: typeof fetch = fetch): Runtime => {
  const retry = createRetryController({ maxRunRetries: 3, maxWaitMilliseconds: profile.capacity.waitMilliseconds, maxTotalWaitMilliseconds: profile.capacity.totalWaitMilliseconds,
    sleep: async (milliseconds) => { capacity.recordRetryWait(milliseconds); await new Promise((done) => setTimeout(done, milliseconds)); } });
  const credentials = { ...(environment.GITHUB_TOKEN ? { github: `Bearer ${environment.GITHUB_TOKEN}` } : {}),
    ...(environment.HF_TOKEN ? { huggingFace: `Bearer ${environment.HF_TOKEN}` } : {}) };
  const base = createBoundedTransport({ fetch: fetchLike, credentials, limits: { timeoutMilliseconds: profile.capacity.waitMilliseconds, concurrentRequests: profile.capacity.concurrentRequests,
    requestCount: profile.capacity.requestCount, responseBytes: profile.capacity.responseBytes, pages: profile.capacity.githubPages } });
  const runtime: Runtime = { capacity, retry, environment, responses: new Map(), hashes: [], replayCursors: new Map(), replay: false, transport: undefined as unknown as BoundedTransport,
    beginReplay: () => { runtime.replay = true; runtime.replayCursors.clear(); } };
  const request = async (kind: "json" | "bytes", input: RequestInput, page?: number): Promise<unknown> => {
    const key = responseKey(input); const cached = runtime.responses.get(key) ?? [];
    if (runtime.replay) { const offset = runtime.replayCursors.get(key) ?? 0; const value = cached[offset];
      if (value === undefined) throw new PreparationError(); runtime.replayCursors.set(key, offset + 1); return structuredClone(value); }
    const lease = capacity.beginRequest();
    try {
      const value = kind === "json" ? await base.requestJson(input, page) : await base.requestBytes(input, page);
      const bytes = kind === "json" ? canonicalBytes(value) : value as Uint8Array;
      lease.complete(bytes.byteLength); runtime.hashes.push(createHash("sha256").update(bytes).digest("hex"));
      runtime.responses.set(key, [...cached, structuredClone(value)]);
      if (kind === "json" && new URL(input.url).pathname === "/search/commits") {
        const query = profile.github.queries.find(({ query: value }) => value === new URL(input.url).searchParams.get("q"));
        const body = value as Record<string, unknown>;
        capacity.recordGitHubPage(query?.id ?? "", Array.isArray(body.items) ? body.items.length : 0);
      }
      return value;
    } catch (error) { lease.release(); throw error; }
  };
  runtime.transport = Object.freeze({ requestJson: (input: RequestInput, page?: number) => request("json", input, page), requestBytes: (input: RequestInput, page?: number) => request("bytes", input, page) as Promise<Uint8Array> });
  return runtime;
};
const runBlobWorker = async (row: StackMetadataRow, limits: BlobLimits, environment: Environment): Promise<SelectedStackBlob> => {
  const directory = fileURLToPath(new URL("../stack/", import.meta.url)).replace(/\/$/u, "");
  const script = fileURLToPath(new URL("../stack/fetch_blob.py", import.meta.url));
  const projected = projectBlobWorkerEnvironment(environment) as Record<string, string>;
  const inputRow = Object.fromEntries(["stableRowId", "swhBlobId", "swhContentId", "sourceEncoding", "byteLength"]
    .map((key) => [key, row[key]]));
  return new Promise((resolveWorker, reject) => {
    const child = spawn("uv", ["run", "--project", directory, "--locked", "python", script],
      { cwd: directory, env: projected, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = []; let bytes = 0; let failed = false;
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > limits.perBlobBytes * 2) { failed = true; child.kill(); } else output.push(chunk); });
    child.stderr.on("data", () => { failed = true; }); child.once("error", reject);
    child.once("close", (code) => {
      try {
        if (failed || code !== 0) throw new PreparationError();
        const lines = Buffer.concat(output).toString("utf8").trimEnd().split("\n");
        const value = JSON.parse(lines.length === 1 ? lines[0]! : "null") as SelectedStackBlob;
        if (value.stableRowId !== row.stableRowId || value.swhBlobId !== row.swhBlobId
          || value.byteLength !== row.byteLength) throw new PreparationError();
        resolveWorker(Object.freeze(value));
      } catch { reject(new PreparationError()); }
    });
    child.stdin.end(`${JSON.stringify({ rows: [inputRow], limits })}\n`);
  });
};
const publishWithReport = async (deps: PreparationDependencies, composed: ComposedExperiment, report: unknown): Promise<unknown> => {
  const staged = await deps.stageReport(report);
  let publication: unknown;
  try {
    publication = await deps.publishArtifact({ artifact: composed.artifact, expectedHash: composed.artifactHash, beforeCommit: () => staged.commit() });
  } catch (error) { await staged.rollback(); throw error; }
  await staged.finalize();
  return publication;
};
const stageReport = async (report: unknown): Promise<StagedRunReport> => { await mkdir(dirname(REPORT_PATH), { recursive: true });
  return stageRunReport({ bytes: canonicalBytes(report), targetPath: REPORT_PATH }); };
const defaultDependencies = (): PreparationDependencies => ({
  loadProfile: async () => { const raw = await readFile(PROFILE_URL); const profile = parseCrawlProfile(JSON.parse(raw.toString("utf8")));
    return { profile, canonicalProfileBytes: canonicalBytes(profile) }; },
  environment: () => projectPreparationEnvironment(process.env), createCapacity: createCapacityMeter,
  createRuntime: ({ profile, environment, capacity }) => createPreparationRuntime(profile, environment, capacity),
  preflight: (context) => { const runtime = runtimeOf(context);
    const acknowledgedUsableRevision = context.environment.STACK_V2_ACKNOWLEDGED_USABLE_REVISION;
    if (!acknowledgedUsableRevision) throw new PreparationError();
    return stage(runtime, () => preflightStackAccess({ profile: context.profile, acknowledgedUsableRevision,
    transport: runtime.transport })); },
  searchGitHub: (context) => { const runtime = runtimeOf(context); return stage(runtime, () => crawlGitHubCommitSearch({
    profile: context.profile, transport: runtime.transport, retry: runtime.retry })); },
  bindGitHubLineage: (options) => { const runtime = runtimeOf(options); return stage(runtime, async () =>
    (await bindGitHubLineage({ profile: options.profile, candidates: [options.candidate as any],
      transport: runtime.transport, retry: runtime.retry }))[0]!); },
  admitGitHubCandidate: (options) => { const runtime = runtimeOf(options); return stage(runtime, async () =>
    (await admitGitHubCandidates({ profile: options.profile, profileHash: options.profileHash,
      crawlSnapshotId: options.crawlSnapshotId, candidates: [options.candidate as any],
      transport: runtime.transport, retry: runtime.retry }))[0]!); },
  collectStackMetadata: (options) => workerStage(() => collectStackMetadata({
    profile: options.profile, capacity: options.capacity, configuration: options.configuration,
    rowLimit: options.profile.capacity.stackRowsPerLanguage, environment: options.environment,
    blobAccess: async () => undefined })),
  fetchStackBlob: (options) => workerStage(() =>
    runBlobWorker(options.row as StackMetadataRow, options.limits, options.environment)),
  revalidateStackCandidate: (options) => { const runtime = runtimeOf(options); return stage(runtime, () =>
    revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
      crawlSnapshotId: options.crawlSnapshotId, metadata: options.row as StackMetadataRow,
      selectedBlob: options.blob as SelectedStackBlob, transport: runtime.transport, retry: runtime.retry })); },
  validateLanguageCandidate: (options) => validateLanguageCandidate({ profile: options.profile, candidate: options.candidate as any }),
  finalizeBindings: async (options) => {
    const runtime = runtimeOf(options); runtime.beginReplay();
    const provenanceCandidates = await Promise.all(options.provenanceCandidates.map(async (candidate: any) =>
      (await admitGitHubCandidates({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, candidates: [candidate.lineage], transport: runtime.transport,
        retry: runtime.retry }))[0]!));
    const languageCandidates = await Promise.all(options.languageSelections.map(({ row, blob }) =>
      revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, metadata: row as StackMetadataRow, selectedBlob: blob as SelectedStackBlob,
        transport: runtime.transport, retry: runtime.retry })));
    return Object.freeze({ provenanceCandidates: Object.freeze(provenanceCandidates), languageCandidates: Object.freeze(languageCandidates) });
  },
  generateProvenance: (options) => generateProvenanceRounds(options as any),
  generateLanguage: (options) => generateLanguageRounds(options as any), compose: composeExperimentArtifact,
  createReport: createRunReport, stageReport,
  publishArtifact: async ({ artifact, expectedHash, beforeCommit }) => { await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
    return publishArtifact({ artifact, expectedHash, targetPath: ARTIFACT_PATH, ...(beforeCommit ? { beforeCommit } : {}) }); },
  now: () => new Date(), uuid: randomUUID, log: (message) => console.info(message),
});
export const runPreparationCli = async (): Promise<PreparationResult> => process.argv.slice(2).length === 0 ? prepareLocalExperiment() : Promise.reject(new Error("COMMAND_ARGUMENTS_REJECTED"));
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void runPreparationCli().catch(() => { process.exitCode = 1; });
