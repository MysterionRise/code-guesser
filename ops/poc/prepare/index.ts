import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishArtifact } from "./artifact-store";
import { fetchSelectedBlob, projectBlobWorkerEnvironment, type BlobWorkerLimits } from "./blob-worker";
import { canonicalBytes, canonicalHash } from "./canonical";
import { createCapacityMeter, type CapacityMeter, type CapacitySnapshot } from "./capacity";
import { aiCreditFor } from "./ai-credit";
import { generateAiRounds } from "./ai-rounds";
import { composeExperimentArtifact, containsProtected, type ComposedExperiment } from "./compose";
import { admitGitHubCandidates } from "./github-admission";
import { bindGitHubLineage } from "./github-lineage";
import { crawlGitHubCommitSearch, type GitHubQueryClassification } from "./github-search";
import { generateLanguageRounds, validateLanguageCandidate } from "./language-rounds";
import { artifactFixtures, CROSS_DECK_KEYS } from "./model";
import { parseCrawlProfile, STACK_LANGUAGES, type CrawlProfile, type StackLanguage } from "./profile";
import { generateProjectRounds, projectExcerptAllowed } from "./project-rounds";
import { createRetryController, type RetryController } from "./retry";
import type { GeneratedRounds } from "./round-projection";
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
type FailureStage = "PREFLIGHT" | "DISCOVERY" | "ADMISSION" | "STACK_METADATA" | "BLOB_RETRIEVAL" | "SELECTION" | "PUBLICATION";
interface RunState { readonly diagnostics: Map<string, number>; discovered: number; repositoriesAdmitted: number; githubRevalidations: number; screened: number; duplicatesRejected: number }
export interface PreparationDependencies {
  loadProfile(): Promise<Readonly<{ profile: CrawlProfile; canonicalProfileBytes: Uint8Array }>>; environment(): Environment;
  createCapacity(options: Parameters<typeof createCapacityMeter>[0]): CapacityMeter; createRuntime(options: Readonly<{ profile: CrawlProfile; environment: Environment; capacity: CapacityMeter }>): unknown;
  preflight(options: Context): Promise<StageResult<unknown>>; searchGitHub(options: Context): Promise<StageResult<Readonly<{ candidates: readonly unknown[]; queryClassifications: readonly GitHubQueryClassification[] }>>>;
  bindGitHubLineage(options: Context & Readonly<{ candidate: unknown }>): Promise<StageResult<unknown>>; admitGitHubCandidate(options: Context & Readonly<{ candidate: unknown; crawlSnapshotId: string }>): Promise<StageResult<unknown>>;
  collectStackMetadata(options: Context & Readonly<{ configuration: StackLanguage }>): Promise<StageResult<readonly unknown[]>>; fetchStackBlob(options: Context & Readonly<{ row: unknown; limits: BlobLimits }>): Promise<StageResult<Readonly<{ byteLength: number }>>>;
  revalidateStackCandidate(options: Context & Readonly<{ row: unknown; blob: unknown; crawlSnapshotId: string }>): Promise<StageResult<unknown>>;
  validateLanguageCandidate(options: Context & Readonly<{ candidate: unknown }>): unknown;
  finalizeBindings?(options: Context & Readonly<{ crawlSnapshotId: string; projectCandidates: readonly unknown[]; aiCandidates: readonly unknown[]; languageSelections: readonly StackSelection[] }>): Promise<Readonly<{ projectCandidates: readonly unknown[]; aiCandidates: readonly unknown[]; languageCandidates: readonly unknown[] }>>;
  generateProject(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[]; distractorPool: readonly string[] }>): GeneratedRounds;
  generateLanguage(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds;
  generateAi(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds;
  compose(options: Parameters<typeof composeExperimentArtifact>[0]): ComposedExperiment; createReport(input: Readonly<Record<string, unknown>>): unknown;
  stageReport(report: unknown): Promise<StagedRunReport>; publishArtifact(input: Readonly<{ artifact: unknown; expectedHash: string; beforeCommit?: () => Promise<void> }>): Promise<unknown>;
  now(): Date; uuid(): string; log(message: string): void; }
type BlobLimits = BlobWorkerLimits;
export { projectBlobWorkerEnvironment };
export interface PreparationResult { readonly artifactHash: string; readonly crawlSnapshotId: string; readonly publication: unknown }
export class PreparationError extends Error { public constructor() { super("PREPARATION_FAILED"); this.name = "PreparationError"; } }
const PROFILE_URL = new URL("../profiles/local-real-rounds.v2.json", import.meta.url); const ARTIFACT_PATH = fileURLToPath(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url));
const REPORT_PATH = fileURLToPath(new URL("../stack/tmp/local-experiment-run.json", import.meta.url)); const SHA256 = /^[0-9a-f]{64}$/u;
const projectEnvironment = (source: Environment, keys: readonly string[]): Environment => Object.freeze(Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])));
export const projectPreparationEnvironment = (source: Environment): Environment => projectEnvironment(source, ["PATH", "HOME", "HF_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "STACK_V2_ACKNOWLEDGED_USABLE_REVISION"]);
const addHashes = (target: string[], values: readonly string[]): void => { for (const value of values) {
  if (!SHA256.test(value)) throw new PreparationError(); if (!target.includes(value)) target.push(value);
} };
const QUERY_COMPLETENESS = new Set(["COMPLETE", "PROVIDER_REPORTED_INCOMPLETE"]);
const REASON_CODE = /^[A-Z][A-Z0-9_]*$/u; const STATUS_CLASS = /^(?:none|[1-5]xx)$/u; const FAILURE_CAUSE_DEPTH = 4;
/** Retains only a stable reason code and status class from a failure chain; anything else is dropped before logging. */
const failureDiagnostic = (error: unknown): Readonly<{ code: string; statusClass: string }> | undefined => {
  let code: string | undefined; let statusClass = "none"; let current: unknown = error;
  for (let depth = 0; depth < FAILURE_CAUSE_DEPTH && typeof current === "object" && current !== null; depth += 1) {
    const { code: candidate, diagnostic, cause } = current as Record<string, unknown>;
    if (code === undefined && typeof candidate === "string" && REASON_CODE.test(candidate)) code = candidate;
    const observed = typeof diagnostic === "object" && diagnostic !== null ? (diagnostic as Record<string, unknown>).statusClass : undefined;
    if (statusClass === "none" && typeof observed === "string" && STATUS_CLASS.test(observed)) statusClass = observed;
    current = cause;
  }
  return code === undefined ? undefined : Object.freeze({ code, statusClass });
};
/** Names an uncoded failure by its code-shaped message or its class, never by any other detail. */
const uncodedDiagnostic = (error: unknown): Readonly<{ code: string; statusClass: string }> => {
  if (error instanceof PreparationError) return Object.freeze({ code: "INVARIANT_REJECTED", statusClass: "none" });
  const message = error instanceof Error && REASON_CODE.test(error.message) ? error.message : undefined;
  const name = error instanceof Error ? error.constructor.name.replace(/[^A-Za-z0-9]/gu, "").toUpperCase() : "";
  return Object.freeze({ code: message ?? `UNCODED_${name || "ERROR"}`, statusClass: "none" });
};
const STACK_FRAME = /^\s*at (?:async )?([^\s(]+) \((.*?):\d+:\d+\)$/u;
/** The first named frame outside the throw helpers: a function and file name only, never a line, URL, or value. */
const failureSite = (error: unknown): string | undefined => {
  const lines = error instanceof Error && typeof error.stack === "string" ? error.stack.split("\n") : [];
  for (const line of lines) {
    const match = STACK_FRAME.exec(line); if (!match) continue;
    const name = match[1]!; const file = match[2]!.split("/").at(-1)!.replace(/\?.*$/u, "");
    if (name === "fail" || name.endsWith(".fail") || name.startsWith("new ") || name.startsWith("node:")) continue;
    if (!/^[A-Za-z0-9_.-]+\.[cm]?[jt]sx?$/u.test(file)) continue;
    return `${name.replace(/[^A-Za-z0-9_$.<>]/gu, "")}@${file}`;
  }
  return undefined;
};
const validateClassifications = (profile: CrawlProfile, values: unknown): readonly GitHubQueryClassification[] => {
  if (!Array.isArray(values) || values.length !== profile.github.queries.length) throw new PreparationError(); const seen = new Set<string>();
  for (const [index, value] of values.entries()) { if (typeof value !== "object" || value === null) throw new PreparationError();
    const { queryId, completeness } = value as Record<string, unknown>;
    if (queryId !== profile.github.queries[index]!.id || seen.has(queryId) || !QUERY_COMPLETENESS.has(completeness as string)) throw new PreparationError();
    seen.add(queryId); }
  return values as readonly GitHubQueryClassification[];
};
/** The stable code of a candidate rejection: a wrapped retry failure reports its transport cause instead of the wrapper. */
const rejectionCode = (error: unknown): string => {
  const codeOf = (value: unknown): string | undefined => {
    if (!(value instanceof Error)) return undefined;
    const { code } = value as Error & { code?: unknown };
    if (typeof code === "string" && REASON_CODE.test(code)) return code;
    return REASON_CODE.test(value.message) ? value.message : undefined;
  };
  const own = codeOf(error);
  if (own === "RETRY_SIGNAL_MISSING") return codeOf((error as Error).cause) ?? own;
  return own ?? "CANDIDATE_REJECTED";
};
const noteRejection = (state: RunState, stage: DiagnosticStage, error: unknown): void => { const message = rejectionCode(error);
  const key = `${stage}\0${message}`; state.diagnostics.set(key, (state.diagnostics.get(key) ?? 0) + 1);
};
const aiCredited = (candidate: unknown, profile: CrawlProfile): boolean => aiCreditFor(String((candidate as any).lineage?.commitMessage ?? ""), profile.aiCredits).recorded;
const queryRole = (profile: CrawlProfile, candidate: unknown): string | undefined => profile.github.queries.find(({ id }) => id === (candidate as any)?.queryId)?.role;
const provisionalSnapshot = (profileHash: string, hashes: readonly string[]): string => canonicalHash({ profileHash, acceptedResponseHashes: hashes.length > 0 ? hashes : [canonicalHash("capture")] });
const remainingBlobLimits = (profile: CrawlProfile, snapshot: CapacitySnapshot): BlobLimits => { const totalBlobBytes = Math.max(1, profile.capacity.totalBlobBytes - snapshot.totalBlobBytes); return Object.freeze({
  blobAttempts: Math.max(1, profile.capacity.blobAttempts - snapshot.blobAttempts + 1), successfulBlobs: Math.max(1, profile.capacity.successfulBlobs - snapshot.successfulBlobs), perBlobBytes: profile.capacity.perBlobBytes, totalBlobBytes, temporaryDiskBytes: Math.max(1, profile.capacity.temporaryDiskBytes - snapshot.temporaryDiskBytes),
  requestLimit: Math.max(1, profile.capacity.requestCount - snapshot.requestCount), networkByteLimit: Math.min(profile.capacity.perBlobBytes, totalBlobBytes) }); };
/** FR-029: licence screening precedes any blob download. A row without a licence list is left to revalidation. */
const licensesAllowed = (profile: CrawlProfile, row: unknown): boolean => { const licenses = (row as any)?.detectedLicenses;
  if (!Array.isArray(licenses)) return true;
  return licenses.length > 0 && licenses.every((identifier) => profile.licenses.includes(identifier)); };
const stackOrder = (left: any, right: any): number => {
  for (const key of ["stableRowId", "repository", "swhRevisionId", "path", "swhContentId"]) {
    const order = String(left[key]) < String(right[key]) ? -1 : String(left[key]) > String(right[key]) ? 1 : 0;
    if (order !== 0) return order;
  } return 0; };
const PROTECTED_SOURCE_KEYS = ["repository", "repositoryUrl", "authorName", "authorLogin", "authorSourceUrl", "path", "blob", "rawContentHash",
  "licenseName", "licenseSpdx", "licenseFileUrl", "commit", "commitUrl", "blobUrl"] as const;
const excerptOf = (candidate: any): string => String(candidate.lineage?.excerpt ?? candidate.excerpt ?? "");
/**
 * FR-009 applied per candidate: the public text the five rounds would expose (fixed templates plus every
 * selected excerpt) may not contain any selected source's protected values as a whole token. Checking at
 * selection time lets the run move to the next candidate instead of failing at composition.
 */
const revealsProtected = (profile: CrawlProfile, candidate: any, selected: readonly unknown[]): boolean => {
  const all = [...selected, candidate];
  const publicText = `${JSON.stringify(profile.templates)}\n${all.map(excerptOf).join("\n")}`;
  return all.some((item: any) => { const source = item.source ?? item;
    return PROTECTED_SOURCE_KEYS.some((key) => typeof source[key] === "string" && source[key].length > 0
      && !(key === "rawContentHash" && source[key] === source.excerptHash) && containsProtected(publicText, source[key])); });
};
const sameIdentity = (keys: readonly string[], candidate: any, selected: readonly unknown[]): boolean => { const source = candidate.source ?? candidate;
  return keys.some((key) => selected.some((value: any) => typeof source[key] === "string" && source[key] === (value.source ?? value)[key])); };
/** FR-026 as amended: full deduplication within a deck; commit, blob, raw content, and excerpt across decks. */
const collidesWithSelected = (profile: CrawlProfile, candidate: any, sameDeck: readonly unknown[], otherDecks: readonly unknown[] = []): boolean =>
  sameIdentity(profile.deduplication, candidate, sameDeck) || sameIdentity(CROSS_DECK_KEYS, candidate, otherDecks);
type GitHubDecks = Readonly<{ project: readonly unknown[]; ai: readonly unknown[] }>;
/**
 * Revision 12: five project rounds from `ordinary` queries with distinct repositories; five AI rounds with
 * up to three credited commits from `ai-credit` queries and the rest uncredited from `ordinary` queries,
 * at least two of each. Admitted ordinary candidates the project deck cannot use stay available to the AI deck.
 */
const selectGitHub = async (context: Context, deps: PreparationDependencies, hashes: string[], pool: readonly unknown[], state: RunState): Promise<GitHubDecks> => {
  const { profile } = context; const { projectRounds, aiRounds, aiMinimumPerOutcome } = profile.selection;
  const ordinary = pool.filter((candidate) => queryRole(profile, candidate) === "ordinary");
  const credited = pool.filter((candidate) => queryRole(profile, candidate) === "ai-credit");
  const project: unknown[] = []; const aiYes: unknown[] = []; const aiNo: unknown[] = []; const spare: unknown[] = [];
  const all = (): unknown[] => [...project, ...aiYes, ...aiNo];
  const admit = async (candidate: unknown): Promise<unknown | undefined> => {
    let lineage: StageResult<unknown>;
    try { lineage = await deps.bindGitHubLineage({ ...context, candidate }); addHashes(hashes, lineage.acceptedResponseHashes);
    } catch (error) { noteRejection(state, "DISCOVERY", error); return undefined; }
    try {
      const admitted = await deps.admitGitHubCandidate({ ...context, candidate: lineage.value, crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
      addHashes(hashes, admitted.acceptedResponseHashes); state.repositoriesAdmitted += 1; state.screened += 1;
      return admitted.value;
    } catch (error) { noteRejection(state, "ADMISSION", error); return undefined; }
  };
  const accepts = (admitted: any, deck: readonly unknown[], others: readonly unknown[]): boolean => {
    if (collidesWithSelected(profile, admitted, deck, others)) { state.duplicatesRejected += 1; noteRejection(state, "DEDUPLICATION", new Error("SOURCE_DUPLICATE")); return false; }
    if (revealsProtected(profile, admitted, all())) { noteRejection(state, "SCREENING", new Error("PUBLIC_CONTAINMENT_REJECTED")); return false; }
    return true;
  };
  const projectEligible = (admitted: any): boolean => {
    if (!projectExcerptAllowed(String(admitted.lineage?.excerpt ?? ""), String(admitted.source?.repository ?? ""))) { noteRejection(state, "SCREENING", new Error("PROJECT_NAME_IN_EXCERPT")); return false; }
    return accepts(admitted, project, [...aiYes, ...aiNo]);
  };
  const absentEligible = (admitted: any): boolean => !aiCredited(admitted, profile) && accepts(admitted, [...aiYes, ...aiNo], project);
  let cursor = 0;
  while (project.length < projectRounds && cursor < ordinary.length) {
    const admitted = await admit(ordinary[cursor++]); if (admitted === undefined) continue;
    if (projectEligible(admitted)) project.push(admitted); else spare.push(admitted);
  }
  if (project.length < projectRounds) throw new PreparationError();
  const creditedTarget = aiRounds - aiMinimumPerOutcome;
  for (const candidate of credited) {
    if (aiYes.length >= creditedTarget) break;
    const admitted = await admit(candidate); if (admitted === undefined) continue;
    if (!aiCredited(admitted, profile)) { noteRejection(state, "SCREENING", new Error("AI_CREDIT_ABSENT")); continue; }
    if (accepts(admitted, [...aiYes, ...aiNo], project)) aiYes.push(admitted);
  }
  if (aiYes.length < aiMinimumPerOutcome) throw new PreparationError();
  const absentTarget = aiRounds - aiYes.length;
  for (const admitted of spare) { if (aiNo.length >= absentTarget) break; if (absentEligible(admitted)) aiNo.push(admitted); }
  while (aiNo.length < absentTarget && cursor < ordinary.length) {
    const admitted = await admit(ordinary[cursor++]); if (admitted === undefined) continue;
    if (absentEligible(admitted)) aiNo.push(admitted);
  }
  if (aiNo.length < absentTarget) throw new PreparationError();
  return Object.freeze({ project: Object.freeze(project), ai: Object.freeze([...aiYes, ...aiNo]) });
};
const selectStack = async (context: Context, deps: PreparationDependencies, hashes: string[], rows: readonly unknown[], github: readonly unknown[], state: RunState) => {
  const selected: StackSelection[] = [];
  for (const configuration of context.profile.stack.configurations) {
    const ordered = rows.filter((item) => (item as any).detectedLanguage === configuration.language).sort(stackOrder);
    for (const row of ordered) {
      if (!licensesAllowed(context.profile, row)) { noteRejection(state, "SCREENING", new Error("LICENSE_REJECTED")); continue; }
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
        if (collidesWithSelected(context.profile, eligible, selected.map(({ candidate }) => candidate), github)) { state.duplicatesRejected += 1; throw new Error("SOURCE_DUPLICATE"); }
        stage = "SCREENING";
        if (revealsProtected(context.profile, eligible, [...github, ...selected.map(({ candidate }) => candidate)])) throw new Error("PUBLIC_CONTAINMENT_REJECTED");
        lease.accept();
        selected.push(Object.freeze({ row, blob: fetched.value, candidate: eligible }));
        break;
      } catch (error) { noteRejection(state, stage, error); lease.release(); }
    }
  }
  if (selected.length !== context.profile.selection.languageRounds) throw new PreparationError();
  return Object.freeze(selected);
};
const reportInput = (context: Context, composed: ComposedExperiment, executionId: string, observedAt: string, state: RunState, classifications: readonly GitHubQueryClassification[]) => {
  const snapshot = context.capacity.snapshot();
  const github = Object.values(snapshot.github);
  const fixtures = artifactFixtures(composed.artifact);
  const sources = fixtures.map(({ source }) => `${String(source.repository)}@${String(source.commit)}:${String(source.path)}`);
  return {
    schemaVersion: "local-experiment-run.v2", executionId, observedAt, profileVersion: context.profile.profileVersion, githubApiVersion: context.profile.github.apiVersion,
    stackRelease: context.profile.stack.release, stackRevision: context.profile.stack.revision,
    githubQueries: context.profile.github.queries.map((query, index) => ({ ...query, pageCeiling: context.profile.capacity.githubPages, resultCeiling: context.profile.capacity.githubResults, completeness: classifications[index]!.completeness })),
    stackConfigurations: context.profile.stack.configurations.map(({ language, configuration }) => ({ language, configuration, rowCeiling: context.profile.capacity.stackRowsPerLanguage, completeness: "COMPLETE" })),
    counts: { requests: snapshot.requestCount, githubPages: github.reduce((n, value) => n + value.pages, 0),
      githubResults: github.reduce((n, value) => n + value.results, 0), repositoriesAdmitted: state.repositoriesAdmitted,
      stackRows: snapshot.stackRows, blobAttempts: snapshot.blobAttempts, blobsRetrieved: snapshot.successfulBlobs,
      githubRevalidations: state.githubRevalidations, screened: state.screened, duplicatesRejected: state.duplicatesRejected, selected: fixtures.length },
    bytes: { githubResponses: snapshot.responseBytes, stackMetadata: snapshot.stackMetadataBytes, stackBlobs: snapshot.totalBlobBytes },
    waits: { retries: snapshot.retryWaits, milliseconds: snapshot.waitedMilliseconds },
    diagnostics: [...state.diagnostics].map(([key, count]) => { const [stage, reasonCode] = key.split("\0"); return { stage, reasonCode, count }; }), outcome: "SUCCESS", result: { artifactHash: composed.artifactHash, crawlSnapshotId: composed.artifact.crawlSnapshot.id, sourceIdentities: sources },
  };
};
export const prepareLocalExperiment = async (deps: PreparationDependencies = defaultDependencies()): Promise<PreparationResult> => {
  let stage: FailureStage = "PREFLIGHT";
  const state: RunState = { diagnostics: new Map(), discovered: 0, repositoriesAdmitted: 0, githubRevalidations: 0, screened: 0, duplicatesRejected: 0 };
  try {
    const loaded = await deps.loadProfile();
    const profileHash = canonicalHash(loaded.profile);
    if (canonicalHash(JSON.parse(new TextDecoder().decode(loaded.canonicalProfileBytes))) !== profileHash) throw new PreparationError();
    const environment = deps.environment();
    const capacity = deps.createCapacity({ limits: loaded.profile.capacity,
      githubQueryIds: loaded.profile.github.queries.map(({ id }) => id), stackLanguages: STACK_LANGUAGES });
    const runtime = deps.createRuntime({ profile: loaded.profile, environment, capacity });
    const context = Object.freeze({ ...loaded, profileHash, environment, capacity, runtime });
    const hashes: string[] = [];
    addHashes(hashes, (await deps.preflight(context)).acceptedResponseHashes);
    stage = "DISCOVERY";
    const search = await deps.searchGitHub(context); addHashes(hashes, search.acceptedResponseHashes);
    state.discovered = Array.isArray(search.value.candidates) ? search.value.candidates.length : 0;
    const classifications = validateClassifications(loaded.profile, search.value.queryClassifications);
    stage = "ADMISSION";
    const githubDecks = await selectGitHub(context, deps, hashes, search.value.candidates, state);
    const distractorPool = [...new Set(search.value.candidates.filter((candidate) => queryRole(loaded.profile, candidate) === "ordinary")
      .map((candidate) => String((candidate as any).repository)))];
    const metadata: unknown[] = [];
    stage = "STACK_METADATA";
    for (const { configuration } of loaded.profile.stack.configurations) {
      const result = await deps.collectStackMetadata({ ...context, configuration });
      addHashes(hashes, result.acceptedResponseHashes); metadata.push(...result.value);
    }
    stage = "BLOB_RETRIEVAL";
    const languageSelections = await selectStack(context, deps, hashes, metadata, [...githubDecks.project, ...githubDecks.ai], state);
    stage = "SELECTION";
    const crawlSnapshotId = provisionalSnapshot(profileHash, hashes);
    const finalized = deps.finalizeBindings
      ? await deps.finalizeBindings({ ...context, crawlSnapshotId, projectCandidates: githubDecks.project, aiCandidates: githubDecks.ai, languageSelections })
      : { projectCandidates: githubDecks.project, aiCandidates: githubDecks.ai, languageCandidates: languageSelections.map(({ candidate }) => candidate) };
    if (deps.finalizeBindings && ([...finalized.projectCandidates, ...finalized.aiCandidates].some((candidate: any) => candidate.source?.crawlSnapshotId !== crawlSnapshotId)
      || finalized.languageCandidates.some((candidate: any) => candidate.crawlSnapshotId !== crawlSnapshotId))) throw new PreparationError();
    const project = deps.generateProject({ profile: loaded.profile, candidates: finalized.projectCandidates, distractorPool });
    const language = deps.generateLanguage({ profile: loaded.profile, candidates: finalized.languageCandidates });
    const ai = deps.generateAi({ profile: loaded.profile, candidates: finalized.aiCandidates });
    const { projectRounds, languageRounds, aiRounds } = loaded.profile.selection;
    if (project.fixtures.length !== projectRounds || language.fixtures.length !== languageRounds || ai.fixtures.length !== aiRounds) throw new PreparationError();
    const composed = deps.compose({ profile: loaded.profile, canonicalProfileBytes: loaded.canonicalProfileBytes,
      acceptedResponseHashes: Object.freeze(hashes), project, language, ai });
    if (composed.artifact.crawlSnapshot.id !== crawlSnapshotId) throw new PreparationError();
    const report = deps.createReport(reportInput(context, composed, deps.uuid(), deps.now().toISOString(), state, classifications));
    stage = "PUBLICATION";
    const publication = await publishWithReport(deps, composed, report);
    if (classifications.some(({ completeness }) => completeness === "PROVIDER_REPORTED_INCOMPLETE")) deps.log("GITHUB_SEARCH_INCOMPLETE");
    deps.log("PREPARATION_COMPLETE");
    return Object.freeze({ artifactHash: composed.artifactHash, crawlSnapshotId, publication });
  } catch (error) {
    const diagnostic = failureDiagnostic(error) ?? uncodedDiagnostic(error);
    deps.log(`PREPARATION_STAGE_FAILED ${stage} ${diagnostic.code} ${diagnostic.statusClass}`);
    const site = failureSite(error);
    if (site) deps.log(`PREPARATION_FAILURE_SITE ${site}`);
    if (stage === "ADMISSION" || stage === "BLOB_RETRIEVAL" || stage === "SELECTION") {
      // Counts and stable rejection codes only: the same aggregates a successful run report carries.
      deps.log(`PREPARATION_COUNTS discovered=${state.discovered} admitted=${state.repositoriesAdmitted} duplicates=${state.duplicatesRejected}`);
      const rejections = [...state.diagnostics].map(([key, count]) => `${key.replace("\0", ":")}=${count}`).sort();
      if (rejections.length > 0) deps.log(`PREPARATION_REJECTIONS ${rejections.join(" ")}`);
    }
    deps.log("PREPARATION_FAILED"); throw new PreparationError();
  }
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
  fetchStackBlob: (options) => workerStage(() => fetchSelectedBlob({
    row: options.row as StackMetadataRow, limits: options.limits, environment: options.environment, capacity: options.capacity })),
  revalidateStackCandidate: (options) => { const runtime = runtimeOf(options); return stage(runtime, () =>
    revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
      crawlSnapshotId: options.crawlSnapshotId, metadata: options.row as StackMetadataRow,
      selectedBlob: options.blob as SelectedStackBlob, transport: runtime.transport, retry: runtime.retry })); },
  validateLanguageCandidate: (options) => validateLanguageCandidate({ profile: options.profile, candidate: options.candidate as any }),
  finalizeBindings: async (options) => {
    const runtime = runtimeOf(options); runtime.beginReplay();
    const readmit = (candidates: readonly unknown[]) => Promise.all(candidates.map(async (candidate: any) =>
      (await admitGitHubCandidates({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, candidates: [candidate.lineage], transport: runtime.transport,
        retry: runtime.retry }))[0]!));
    const projectCandidates = await readmit(options.projectCandidates);
    const aiCandidates = await readmit(options.aiCandidates);
    const languageCandidates = await Promise.all(options.languageSelections.map(({ row, blob }) =>
      revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, metadata: row as StackMetadataRow, selectedBlob: blob as SelectedStackBlob,
        transport: runtime.transport, retry: runtime.retry })));
    return Object.freeze({ projectCandidates: Object.freeze(projectCandidates), aiCandidates: Object.freeze(aiCandidates), languageCandidates: Object.freeze(languageCandidates) });
  },
  generateProject: (options) => generateProjectRounds(options as any),
  generateLanguage: (options) => generateLanguageRounds(options as any),
  generateAi: (options) => generateAiRounds(options as any), compose: composeExperimentArtifact,
  createReport: createRunReport, stageReport,
  publishArtifact: async ({ artifact, expectedHash, beforeCommit }) => { await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
    return publishArtifact({ artifact, expectedHash, targetPath: ARTIFACT_PATH, ...(beforeCommit ? { beforeCommit } : {}) }); },
  now: () => new Date(), uuid: randomUUID, log: (message) => console.info(message),
});
export const runPreparationCli = async (): Promise<PreparationResult> => process.argv.slice(2).length === 0 ? prepareLocalExperiment() : Promise.reject(new Error("COMMAND_ARGUMENTS_REJECTED"));
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void runPreparationCli().catch(() => { process.exitCode = 1; });
