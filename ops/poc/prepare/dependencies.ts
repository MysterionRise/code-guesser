import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { bindFixCommit, readDatasetBlob, readDatasetBugs } from "./github-fixes";
import { generateBeforeAfterRounds } from "./before-after-rounds";
import { publishArtifact } from "./artifact-store";
import { fetchSelectedBlob } from "./blob-worker";
import { canonicalBytes } from "./canonical";
import { createCapacityMeter } from "./capacity";
import { composeExperimentArtifact } from "./compose";
import { curatedDeck } from "./curated-decks";
import { PreparationError } from "./diagnostics";
import { admitGitHubCandidates, describeGitHubRepository, screenGitHubRepository } from "./github-admission";
import { bindGitHubFile, listGitHubDirectory, readGitHubFile } from "./github-files";
import { bindGitHubLineage, type GitHubLineageCandidate } from "./github-lineage";
import { crawlGitHubCommitSearch } from "./github-search";
import { generateLanguageRounds, validateLanguageCandidate } from "./language-rounds";
import { parseCrawlProfile } from "./profile";
import { openJournal, type JournalMode } from "./journal";
import { generateProjectRounds } from "./project-rounds";
import { stageRunReport, type StagedRunReport } from "./report-store";
import { createRunReport } from "./run-report";
import { createPreparationRuntime, runtimeOf, stage, workerStage, type Runtime } from "./runtime";
import { preflightStackAccess } from "./stack-access";
import { collectStackMetadata, type StackMetadataRow } from "./stack-metadata";
import { revalidateStackCandidate, type SelectedStackBlob } from "./stack-revalidation";
import type { Environment, PreparationDependencies, StackSelection } from "./types";
import { journaledWorker } from "./worker-journal";

const PROFILE_URL = new URL("../profiles/local-real-rounds.v5.json", import.meta.url);
const ARTIFACT_PATH = fileURLToPath(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url));
const REPORT_PATH = fileURLToPath(new URL("../stack/tmp/local-experiment-run.json", import.meta.url));
const PIN_PATH = fileURLToPath(new URL("../../../apps/game/src/demo/local-real-experiment.pin.server.ts", import.meta.url));
const FAILURE_REPORT_PATH = fileURLToPath(new URL("../stack/tmp/local-experiment-last-failure.json", import.meta.url));
export const JOURNAL_PATH = fileURLToPath(new URL("../stack/tmp/journal/run.jsonl", import.meta.url));

const projectEnvironment = (source: Environment, keys: readonly string[]): Environment =>
  Object.freeze(Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])));
export const projectPreparationEnvironment = (source: Environment): Environment => projectEnvironment(source, [
  "PATH", "HOME", "HF_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "STACK_V2_ACKNOWLEDGED_USABLE_REVISION",
]);

/**
 * Offline replay needs no credential: the worker request still carries a token field, so it gets a fixed
 * placeholder that is never sent anywhere, and the transport refuses to fetch.
 */
const OFFLINE_TOKEN = "offline-replay-sends-nothing";
const offlineEnvironment = (source: Environment): Environment => Object.freeze({
  ...projectEnvironment(source, ["PATH", "HOME", "STACK_V2_ACKNOWLEDGED_USABLE_REVISION"]), HF_TOKEN: OFFLINE_TOKEN,
});
const refuseNetwork: typeof fetch = async () => { throw Object.assign(new Error("OFFLINE_NETWORK_REFUSED"), { code: "OFFLINE_NETWORK_REFUSED" }); };

const stageReport = async (report: unknown): Promise<StagedRunReport> => {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  return stageRunReport({ bytes: canonicalBytes(report), targetPath: REPORT_PATH });
};

const workerRunner = (runtime: Runtime) => runtime.journal ? { runWorker: journaledWorker(runtime.journal) } : {};

/** The game module that pins the artifact hash; the game plays an artifact only when its hash matches. */
export const pinSource = (hash: string): string => `import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical artifact the last successful
 * \`pnpm prepare:poc\` run validated and published. The preparer writes this file as part of
 * publication; the game plays an artifact only when its hash matches, so an edited, stale,
 * or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "${hash}";
`;

const writeAtomically = async (path: string, text: string): Promise<void> => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { mode: 0o644 });
  await rename(temporary, path);
};

/**
 * Writes the pin inside the artifact's commit window: a failure here restores the previous artifact, and
 * a later failure restores the previous pin, so the artifact and its pin always change together.
 */
const publishWithPin = async (input: Readonly<{ artifact: unknown; expectedHash: string; beforeCommit?: () => Promise<void> }>) => {
  const previousPin = await readFile(PIN_PATH, "utf8").catch(() => undefined);
  let pinned = false;
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
  try {
    return await publishArtifact({ artifact: input.artifact, expectedHash: input.expectedHash, targetPath: ARTIFACT_PATH,
      beforeCommit: async () => {
        await input.beforeCommit?.();
        await writeAtomically(PIN_PATH, pinSource(input.expectedHash));
        pinned = true;
      } });
  } catch (error) {
    if (pinned && previousPin !== undefined) await writeAtomically(PIN_PATH, previousPin).catch(() => undefined);
    throw error;
  }
};

const lineageOf = (candidate: unknown): GitHubLineageCandidate => (candidate as { lineage: GitHubLineageCandidate }).lineage;

export interface DependencyOptions {
  readonly journal: JournalMode;
}

export const defaultDependencies = (options: DependencyOptions = { journal: "fresh" }): PreparationDependencies => ({
  loadProfile: async () => {
    const raw = await readFile(PROFILE_URL);
    const profile = parseCrawlProfile(JSON.parse(raw.toString("utf8")));
    return { profile, canonicalProfileBytes: canonicalBytes(profile) };
  },
  environment: () => options.journal === "offline" ? offlineEnvironment(process.env) : projectPreparationEnvironment(process.env),
  createCapacity: createCapacityMeter,
  createRuntime: ({ profile, environment, capacity }) => createPreparationRuntime(profile, environment, capacity,
    options.journal === "offline" ? refuseNetwork : fetch, openJournal({ mode: options.journal, path: JOURNAL_PATH })),
  preflight: (context) => {
    const runtime = runtimeOf(context);
    const acknowledgedUsableRevision = context.environment.STACK_V2_ACKNOWLEDGED_USABLE_REVISION;
    if (!acknowledgedUsableRevision) throw new PreparationError();
    return stage(runtime, () => preflightStackAccess({ profile: context.profile, acknowledgedUsableRevision, transport: runtime.transport }));
  },
  searchGitHub: (context) => {
    const runtime = runtimeOf(context);
    return stage(runtime, async () => {
      const result = await crawlGitHubCommitSearch({ profile: context.profile, transport: runtime.transport, retry: runtime.retry,
        onQueryRestart: (queryId) => context.capacity.discardGitHubQuery(queryId) });
      runtime.journal?.markDiscoveryComplete();
      return result;
    });
  },
  screenGitHubRepository: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, async () => {
      await screenGitHubRepository({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options.repository);
      return options.repository;
    });
  },
  describeRepository: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => describeGitHubRepository({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options.repository));
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
    blobAccess: async () => undefined, ...workerRunner(runtimeOf(options)) })),
  fetchStackBlob: (options) => workerStage(() => fetchSelectedBlob({
    row: options.row as StackMetadataRow, limits: options.limits, environment: options.environment, capacity: options.capacity,
    ...workerRunner(runtimeOf(options)) })),
  revalidateStackCandidate: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
      crawlSnapshotId: options.crawlSnapshotId, metadata: options.row as StackMetadataRow,
      selectedBlob: options.blob as SelectedStackBlob, transport: runtime.transport, retry: runtime.retry }));
  },
  validateLanguageCandidate: (options) => validateLanguageCandidate({ profile: options.profile,
    candidate: options.candidate as Parameters<typeof validateLanguageCandidate>[0]["candidate"] }),
  bindCuratedFile: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => bindGitHubFile({ profile: options.profile, profileHash: options.profileHash,
      transport: runtime.transport, retry: runtime.retry }, options));
  },
  listCuratedDirectory: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => listGitHubDirectory({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options));
  },
  readDatasetBugs: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => readDatasetBugs({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options.dataset));
  },
  readDatasetBlob: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => readDatasetBlob({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options));
  },
  bindFixCommit: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => bindFixCommit({ profile: options.profile, profileHash: options.profileHash,
      transport: runtime.transport, retry: runtime.retry }, options.pointer));
  },
  readCuratedFile: (options) => {
    const runtime = runtimeOf(options);
    return stage(runtime, () => readGitHubFile({ profile: options.profile, transport: runtime.transport, retry: runtime.retry }, options));
  },
  finalizeBindings: async (options) => {
    const runtime = runtimeOf(options);
    runtime.beginReplay();
    const revalidate = (selections: readonly StackSelection[]) => Promise.all(selections.map(({ row, blob }) =>
      revalidateStackCandidate({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, metadata: row as StackMetadataRow, selectedBlob: blob as SelectedStackBlob,
        transport: runtime.transport, retry: runtime.retry })));
    const beforeAfterCandidates = await Promise.all(options.beforeAfterCandidates.map(async (candidate) =>
      (await admitGitHubCandidates({ profile: options.profile, profileHash: options.profileHash,
        crawlSnapshotId: options.crawlSnapshotId, candidates: [lineageOf(candidate)], transport: runtime.transport,
        retry: runtime.retry }))[0]!));
    return Object.freeze({ beforeAfterCandidates: Object.freeze(beforeAfterCandidates),
      projectCandidates: Object.freeze(await revalidate(options.projectSelections)),
      languageCandidates: Object.freeze(await revalidate(options.languageSelections)) });
  },
  generateProject: (options) => generateProjectRounds(options as Parameters<typeof generateProjectRounds>[0]),
  generateLanguage: (options) => generateLanguageRounds(options as Parameters<typeof generateLanguageRounds>[0]),
  generateBeforeAfter: (options) => generateBeforeAfterRounds(options as Parameters<typeof generateBeforeAfterRounds>[0]),
  generateCurated: ({ deck, ...options }) => curatedDeck(deck).generate(options),
  compose: composeExperimentArtifact,
  createReport: createRunReport,
  stageReport,
  publishArtifact: publishWithPin,
  writeFailureReport: async (report) => {
    await mkdir(dirname(FAILURE_REPORT_PATH), { recursive: true });
    await writeFile(FAILURE_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  },
  finishRuntime: (runtime) => {
    const summary = (runtime as Runtime).journal?.finish();
    return summary && `PREPARATION_JOURNAL mode=${summary.mode} replayed=${summary.replayed} live=${summary.live}`;
  },
  now: () => new Date(),
  uuid: randomUUID,
  log: (message) => console.info(message),
});
