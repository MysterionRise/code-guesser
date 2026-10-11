import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAiRounds } from "./ai-rounds";
import { publishArtifact } from "./artifact-store";
import { fetchSelectedBlob } from "./blob-worker";
import { canonicalBytes } from "./canonical";
import { createCapacityMeter } from "./capacity";
import { composeExperimentArtifact } from "./compose";
import { PreparationError } from "./diagnostics";
import { admitGitHubCandidates, screenGitHubRepository } from "./github-admission";
import { bindGitHubLineage, type GitHubLineageCandidate } from "./github-lineage";
import { crawlGitHubCommitSearch } from "./github-search";
import { generateLanguageRounds, validateLanguageCandidate } from "./language-rounds";
import { parseCrawlProfile } from "./profile";
import { generateProjectRounds } from "./project-rounds";
import { stageRunReport, type StagedRunReport } from "./report-store";
import { createRunReport } from "./run-report";
import { createPreparationRuntime, runtimeOf, stage, workerStage } from "./runtime";
import { preflightStackAccess } from "./stack-access";
import { collectStackMetadata, type StackMetadataRow } from "./stack-metadata";
import { revalidateStackCandidate, type SelectedStackBlob } from "./stack-revalidation";
import type { Environment, PreparationDependencies } from "./types";

const PROFILE_URL = new URL("../profiles/local-real-rounds.v2.json", import.meta.url);
const ARTIFACT_PATH = fileURLToPath(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url));
const REPORT_PATH = fileURLToPath(new URL("../stack/tmp/local-experiment-run.json", import.meta.url));

const projectEnvironment = (source: Environment, keys: readonly string[]): Environment =>
  Object.freeze(Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])));
export const projectPreparationEnvironment = (source: Environment): Environment => projectEnvironment(source, [
  "PATH", "HOME", "HF_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "STACK_V2_ACKNOWLEDGED_USABLE_REVISION",
]);

const stageReport = async (report: unknown): Promise<StagedRunReport> => {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  return stageRunReport({ bytes: canonicalBytes(report), targetPath: REPORT_PATH });
};

const lineageOf = (candidate: unknown): GitHubLineageCandidate => (candidate as { lineage: GitHubLineageCandidate }).lineage;

export const defaultDependencies = (): PreparationDependencies => ({
  loadProfile: async () => {
    const raw = await readFile(PROFILE_URL);
    const profile = parseCrawlProfile(JSON.parse(raw.toString("utf8")));
    return { profile, canonicalProfileBytes: canonicalBytes(profile) };
  },
  environment: () => projectPreparationEnvironment(process.env),
  createCapacity: createCapacityMeter,
  createRuntime: ({ profile, environment, capacity }) => createPreparationRuntime(profile, environment, capacity),
  preflight: (context) => {
    const runtime = runtimeOf(context);
    const acknowledgedUsableRevision = context.environment.STACK_V2_ACKNOWLEDGED_USABLE_REVISION;
    if (!acknowledgedUsableRevision) throw new PreparationError();
    return stage(runtime, () => preflightStackAccess({ profile: context.profile, acknowledgedUsableRevision, transport: runtime.transport }));
  },
  searchGitHub: (context) => {
    const runtime = runtimeOf(context);
    return stage(runtime, () => crawlGitHubCommitSearch({ profile: context.profile, transport: runtime.transport, retry: runtime.retry,
      onQueryRestart: (queryId) => context.capacity.discardGitHubQuery(queryId) }));
  },
  screenGitHubRepository: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, async () => {
      await screenGitHubRepository({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options.repository);
      return options.repository;
    });
  },
  bindGitHubLineage: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, async () => (await bindGitHubLineage({ profile: options.profile,
      candidates: [options.candidate as GitHubLineageCandidate], transport: runtime.transport, retry: runtime.retry }))[0]!);
  },
  admitGitHubCandidate: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, async () => (await admitGitHubCandidates({ profile: options.profile, profileHash: options.profileHash,
      crawlSnapshotId: options.crawlSnapshotId, candidates: [options.candidate as GitHubLineageCandidate],
      transport: runtime.transport, retry: runtime.retry }))[0]!);
  },
  collectStackMetadata: (options) => workerStage(() => collectStackMetadata({
    profile: options.profile, capacity: options.capacity, configuration: options.configuration,
    rowLimit: options.profile.capacity.stackRowsPerLanguage, environment: options.environment,
    blobAccess: async () => undefined })),
  fetchStackBlob: (options) => workerStage(() => fetchSelectedBlob({
    row: options.row as StackMetadataRow, limits: options.limits, environment: options.environment, capacity: options.capacity })),
  revalidateStackCandidate: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
      crawlSnapshotId: options.crawlSnapshotId, metadata: options.row as StackMetadataRow,
      selectedBlob: options.blob as SelectedStackBlob, transport: runtime.transport, retry: runtime.retry }));
  },
  validateLanguageCandidate: (options) => validateLanguageCandidate({ profile: options.profile,
    candidate: options.candidate as Parameters<typeof validateLanguageCandidate>[0]["candidate"] }),
  finalizeBindings: async (options) => {
    const runtime = runtimeOf(options);
    runtime.beginReplay();
    const readmit = (candidates: readonly unknown[]) => Promise.all(candidates.map(async (candidate) =>
      (await admitGitHubCandidates({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, candidates: [lineageOf(candidate)], transport: runtime.transport,
        retry: runtime.retry }))[0]!));
    const projectCandidates = await readmit(options.projectCandidates);
    const aiCandidates = await readmit(options.aiCandidates);
    const languageCandidates = await Promise.all(options.languageSelections.map(({ row, blob }) =>
      revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, metadata: row as StackMetadataRow, selectedBlob: blob as SelectedStackBlob,
        transport: runtime.transport, retry: runtime.retry })));
    return Object.freeze({ projectCandidates: Object.freeze(projectCandidates), aiCandidates: Object.freeze(aiCandidates),
      languageCandidates: Object.freeze(languageCandidates) });
  },
  generateProject: (options) => generateProjectRounds(options as Parameters<typeof generateProjectRounds>[0]),
  generateLanguage: (options) => generateLanguageRounds(options as Parameters<typeof generateLanguageRounds>[0]),
  generateAi: (options) => generateAiRounds(options as Parameters<typeof generateAiRounds>[0]),
  compose: composeExperimentArtifact,
  createReport: createRunReport,
  stageReport,
  publishArtifact: async ({ artifact, expectedHash, beforeCommit }) => {
    await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
    return publishArtifact({ artifact, expectedHash, targetPath: ARTIFACT_PATH, ...(beforeCommit ? { beforeCommit } : {}) });
  },
  now: () => new Date(),
  uuid: randomUUID,
  log: (message) => console.info(message),
});
