import type { BlobWorkerLimits } from "./blob-worker";
import type { CapacityMeter, createCapacityMeter } from "./capacity";
import type { ComposedExperiment, composeExperimentArtifact } from "./compose";
import type { CuratedFile } from "./github-files";
import type { GitHubQueryClassification } from "./github-search";
import type { CrawlProfile, StackLanguage } from "./profile";
import type { StagedRunReport } from "./report-store";
import type { ProjectRoundInput } from "./project-rounds";
import type { GeneratedRounds } from "./round-helpers";

export type Environment = Readonly<Record<string, string | undefined>>;
/** A stage's value plus the hashes of every provider response it accepted, in order. */
export type StageResult<Value> = Readonly<{ value: Value; acceptedResponseHashes: readonly string[] }>;
export type Context = Readonly<{
  profile: CrawlProfile;
  canonicalProfileBytes: Uint8Array;
  profileHash: string;
  environment: Environment;
  capacity: CapacityMeter;
  runtime: unknown;
}>;
export type StackSelection = Readonly<{ row: unknown; blob: unknown; candidate: unknown }>;
export type BlobLimits = BlobWorkerLimits;
export type RepositoryDescription = Readonly<{ description: string | null; fork: boolean; archived: boolean }>;

/** Every effect the preparation command performs; tests replace any of them. */
export interface PreparationDependencies {
  loadProfile(): Promise<Readonly<{ profile: CrawlProfile; canonicalProfileBytes: Uint8Array }>>;
  environment(): Environment;
  createCapacity(options: Parameters<typeof createCapacityMeter>[0]): CapacityMeter;
  createRuntime(options: Readonly<{ profile: CrawlProfile; environment: Environment; capacity: CapacityMeter }>): unknown;
  preflight(options: Context): Promise<StageResult<unknown>>;
  searchGitHub(options: Context): Promise<StageResult<Readonly<{
    candidates: readonly unknown[];
    queryClassifications: readonly GitHubQueryClassification[];
  }>>>;
  screenGitHubRepository(options: Context & Readonly<{ repository: string }>): Promise<StageResult<unknown>>;
  /** A repository's public description and whether it is a fork or archived, for a project round's options. */
  describeRepository(options: Context & Readonly<{ repository: string }>): Promise<StageResult<RepositoryDescription>>;
  bindGitHubLineage(options: Context & Readonly<{ candidate: unknown }>): Promise<StageResult<unknown>>;
  admitGitHubCandidate(options: Context & Readonly<{ candidate: unknown; crawlSnapshotId: string }>): Promise<StageResult<unknown>>;
  collectStackMetadata(options: Context & Readonly<{ configuration: StackLanguage }>): Promise<StageResult<readonly unknown[]>>;
  fetchStackBlob(options: Context & Readonly<{ row: unknown; limits: BlobLimits }>): Promise<StageResult<Readonly<{ byteLength: number }>>>;
  revalidateStackCandidate(options: Context & Readonly<{ row: unknown; blob: unknown; crawlSnapshotId: string }>): Promise<StageResult<unknown>>;
  validateLanguageCandidate(options: Context & Readonly<{ candidate: unknown }>): unknown;
  /** One file of a curated repository at its pinned commit, with its licence and last human author bound. */
  bindCuratedFile(options: Context & Readonly<{ repository: string; commit: string; path: string }>): Promise<StageResult<CuratedFile>>;
  /** Rebinds every selected source to the final crawl snapshot, from responses the run already accepted. */
  finalizeBindings?(options: Context & Readonly<{
    crawlSnapshotId: string;
    beforeAfterCandidates: readonly unknown[];
    projectSelections: readonly StackSelection[];
    languageSelections: readonly StackSelection[];
  }>): Promise<Readonly<{
    beforeAfterCandidates: readonly unknown[];
    projectCandidates: readonly unknown[];
    languageCandidates: readonly unknown[];
  }>>;
  generateProject(options: Readonly<{ profile: CrawlProfile; rounds: readonly ProjectRoundInput[] }>): GeneratedRounds;
  generateLanguage(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds;
  generateBeforeAfter(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds;
  generateAlgorithm(options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds;
  compose(options: Parameters<typeof composeExperimentArtifact>[0]): ComposedExperiment;
  createReport(input: Readonly<Record<string, unknown>>): unknown;
  stageReport(report: unknown): Promise<StagedRunReport>;
  publishArtifact(input: Readonly<{ artifact: unknown; expectedHash: string; beforeCommit?: () => Promise<void> }>): Promise<unknown>;
  /** Keeps the counts-only record of a failed run for diagnosis; never provider data. */
  writeFailureReport?(report: FailureReport): Promise<void>;
  /** Closes the runtime after success or failure; returns one counts-only log line, if any. */
  finishRuntime?(runtime: unknown): string | undefined;
  now(): Date;
  uuid(): string;
  log(message: string): void;
}

export interface PreparationResult {
  readonly artifactHash: string;
  readonly crawlSnapshotId: string;
  readonly publication: unknown;
}

/** What a failed run leaves behind: stable codes, counts, and spend only, the same aggregates its log lines carry. */
export interface FailureReport {
  readonly schemaVersion: "local-experiment-failure.v1";
  readonly executionId: string;
  readonly observedAt: string;
  readonly stage: string;
  readonly code: string;
  readonly statusClass: string;
  readonly site: string | null;
  readonly spend: Readonly<Record<string, number>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly capacity: Readonly<Record<string, unknown>> | null;
  readonly rejections: readonly Readonly<{ stage: string; reasonCode: string; count: number }>[];
  readonly journal: string | null;
}
