import { canonicalHash } from "./canonical";
import type { CapacityMeter } from "./capacity";
import type { ComposedExperiment } from "./compose";
import { defaultDependencies } from "./dependencies";
import {
  createRunState, failureDiagnostic, failureSite, PreparationError, rejectionSummary, uncodedDiagnostic,
  type FailureStage, type RunState,
} from "./diagnostics";
import type { GitHubQueryClassification } from "./github-search";
import { artifactFixtures } from "./model";
import { STACK_LANGUAGES, type CrawlProfile } from "./profile";
import { selectGitHub } from "./select-github";
import { selectStack } from "./select-stack";
import { addHashes, provisionalSnapshot, queryRole, repositoryScreen, view } from "./selection";
import type { Context, PreparationDependencies, PreparationResult } from "./types";

const QUERY_COMPLETENESS = new Set(["COMPLETE", "PROVIDER_REPORTED_INCOMPLETE"]);
const validateClassifications = (profile: CrawlProfile, values: unknown): readonly GitHubQueryClassification[] => {
  if (!Array.isArray(values) || values.length !== profile.github.queries.length) throw new PreparationError();
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (typeof value !== "object" || value === null) throw new PreparationError();
    const { queryId, completeness } = value as Record<string, unknown>;
    if (queryId !== profile.github.queries[index]!.id || seen.has(queryId) || !QUERY_COMPLETENESS.has(completeness as string)) {
      throw new PreparationError();
    }
    seen.add(queryId);
  }
  return values as readonly GitHubQueryClassification[];
};

const reportInput = (context: Context, composed: ComposedExperiment, executionId: string, observedAt: string, state: RunState, classifications: readonly GitHubQueryClassification[]) => {
  const snapshot = context.capacity.snapshot();
  const github = Object.values(snapshot.github);
  const fixtures = artifactFixtures(composed.artifact);
  const sources = fixtures.map(({ source }) => `${String(source.repository)}@${String(source.commit)}:${String(source.path)}`);
  return {
    schemaVersion: "local-experiment-run.v2", executionId, observedAt, profileVersion: context.profile.profileVersion,
    githubApiVersion: context.profile.github.apiVersion, stackRelease: context.profile.stack.release, stackRevision: context.profile.stack.revision,
    githubQueries: context.profile.github.queries.map((query, index) => ({ ...query, pageCeiling: context.profile.capacity.githubPages,
      resultCeiling: context.profile.capacity.githubResults, completeness: classifications[index]!.completeness })),
    stackConfigurations: context.profile.stack.configurations.map(({ language, configuration }) => ({ language, configuration,
      rowCeiling: context.profile.capacity.stackRowsPerLanguage, completeness: "COMPLETE" })),
    counts: { requests: snapshot.requestCount, githubPages: github.reduce((n, value) => n + value.pages, 0),
      githubResults: github.reduce((n, value) => n + value.results, 0), repositoriesAdmitted: state.repositoriesAdmitted,
      stackRows: snapshot.stackRows, blobAttempts: snapshot.blobAttempts, blobsRetrieved: snapshot.successfulBlobs,
      githubRevalidations: state.githubRevalidations, screened: state.screened, duplicatesRejected: state.duplicatesRejected, selected: fixtures.length },
    bytes: { githubResponses: snapshot.responseBytes, stackMetadata: snapshot.stackMetadataBytes, stackBlobs: snapshot.totalBlobBytes },
    waits: { retries: snapshot.retryWaits, milliseconds: snapshot.waitedMilliseconds },
    diagnostics: [...state.diagnostics].map(([key, count]) => { const [stage, reasonCode] = key.split("\0"); return { stage, reasonCode, count }; }),
    outcome: "SUCCESS",
    result: { artifactHash: composed.artifactHash, crawlSnapshotId: composed.artifact.crawlSnapshot.id, sourceIdentities: sources },
  };
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

/** Request spend per stage, logged as counts only on success and on failure. */
const createStageTracker = () => {
  let stage = "PREFLIGHT" as FailureStage;
  let meter: CapacityMeter | undefined;
  let mark = 0;
  const spend = new Map<FailureStage, number>();
  const enter = (next: FailureStage): void => {
    if (meter) {
      const now = meter.snapshot().requestCount;
      spend.set(stage, (spend.get(stage) ?? 0) + now - mark);
      mark = now;
    }
    stage = next;
  };
  return {
    current: (): FailureStage => stage,
    meter: (value: CapacityMeter): void => { meter = value; },
    enter,
    spendLine: (): string | undefined => {
      if (!meter) return undefined;
      enter(stage);
      const parts = [...spend].filter(([, requests]) => requests > 0).map(([name, requests]) => `${name}=${requests} `).join("");
      return `PREPARATION_SPEND ${parts}total=${meter.snapshot().requestCount}`;
    },
  };
};

export const prepareLocalExperiment = async (deps: PreparationDependencies = defaultDependencies()): Promise<PreparationResult> => {
  const state = createRunState();
  const tracker = createStageTracker();
  const logSpend = (): void => { const line = tracker.spendLine(); if (line) deps.log(line); };
  try {
    const loaded = await deps.loadProfile();
    const profileHash = canonicalHash(loaded.profile);
    if (canonicalHash(JSON.parse(new TextDecoder().decode(loaded.canonicalProfileBytes))) !== profileHash) throw new PreparationError();
    const environment = deps.environment();
    const capacity = deps.createCapacity({ limits: loaded.profile.capacity,
      githubQueryIds: loaded.profile.github.queries.map(({ id }) => id), stackLanguages: STACK_LANGUAGES });
    tracker.meter(capacity);
    const runtime = deps.createRuntime({ profile: loaded.profile, environment, capacity });
    const context: Context = Object.freeze({ ...loaded, profileHash, environment, capacity, runtime });
    const hashes: string[] = [];
    addHashes(hashes, (await deps.preflight(context)).acceptedResponseHashes);
    // Stack metadata needs nothing from GitHub and is the likeliest stage to fail, so it runs first:
    // a failure here spends no GitHub requests.
    const metadata: unknown[] = [];
    tracker.enter("STACK_METADATA");
    for (const { configuration } of loaded.profile.stack.configurations) {
      const result = await deps.collectStackMetadata({ ...context, configuration });
      addHashes(hashes, result.acceptedResponseHashes);
      metadata.push(...result.value);
    }
    tracker.enter("DISCOVERY");
    const search = await deps.searchGitHub(context);
    addHashes(hashes, search.acceptedResponseHashes);
    state.discovered = Array.isArray(search.value.candidates) ? search.value.candidates.length : 0;
    const classifications = validateClassifications(loaded.profile, search.value.queryClassifications);
    tracker.enter("ADMISSION");
    const screenRepository = repositoryScreen(context, deps, hashes, state);
    const githubDecks = await selectGitHub(context, deps, hashes, search.value.candidates, state, screenRepository);
    const distractorPool = [...new Set(search.value.candidates.filter((candidate) => queryRole(loaded.profile, candidate) === "ordinary")
      .map((candidate) => String(view(candidate).repository)))];
    tracker.enter("BLOB_RETRIEVAL");
    const languageSelections = await selectStack(context, deps, hashes, metadata, [...githubDecks.project, ...githubDecks.ai], state, screenRepository);
    tracker.enter("SELECTION");
    const crawlSnapshotId = provisionalSnapshot(profileHash, hashes);
    const finalized = deps.finalizeBindings
      ? await deps.finalizeBindings({ ...context, crawlSnapshotId, projectCandidates: githubDecks.project, aiCandidates: githubDecks.ai, languageSelections })
      : { projectCandidates: githubDecks.project, aiCandidates: githubDecks.ai, languageCandidates: languageSelections.map(({ candidate }) => candidate) };
    if (deps.finalizeBindings && ([...finalized.projectCandidates, ...finalized.aiCandidates].some((candidate) => view(candidate).source?.crawlSnapshotId !== crawlSnapshotId)
      || finalized.languageCandidates.some((candidate) => (candidate as { crawlSnapshotId?: unknown }).crawlSnapshotId !== crawlSnapshotId))) throw new PreparationError();
    const project = deps.generateProject({ profile: loaded.profile, candidates: finalized.projectCandidates, distractorPool });
    const language = deps.generateLanguage({ profile: loaded.profile, candidates: finalized.languageCandidates });
    const ai = deps.generateAi({ profile: loaded.profile, candidates: finalized.aiCandidates });
    const { projectRounds, languageRounds, aiRounds } = loaded.profile.selection;
    if (project.fixtures.length !== projectRounds || language.fixtures.length !== languageRounds || ai.fixtures.length !== aiRounds) throw new PreparationError();
    const composed = deps.compose({ profile: loaded.profile, canonicalProfileBytes: loaded.canonicalProfileBytes,
      acceptedResponseHashes: Object.freeze(hashes), project, language, ai });
    if (composed.artifact.crawlSnapshot.id !== crawlSnapshotId) throw new PreparationError();
    const report = deps.createReport(reportInput(context, composed, deps.uuid(), deps.now().toISOString(), state, classifications));
    tracker.enter("PUBLICATION");
    const publication = await publishWithReport(deps, composed, report);
    if (classifications.some(({ completeness }) => completeness === "PROVIDER_REPORTED_INCOMPLETE")) deps.log("GITHUB_SEARCH_INCOMPLETE");
    logSpend();
    deps.log("PREPARATION_COMPLETE");
    return Object.freeze({ artifactHash: composed.artifactHash, crawlSnapshotId, publication });
  } catch (error) {
    const stage = tracker.current();
    const diagnostic = failureDiagnostic(error) ?? uncodedDiagnostic(error);
    deps.log(`PREPARATION_STAGE_FAILED ${stage} ${diagnostic.code} ${diagnostic.statusClass}`);
    const site = failureSite(error);
    if (site) deps.log(`PREPARATION_FAILURE_SITE ${site}`);
    logSpend();
    if (stage === "ADMISSION" || stage === "BLOB_RETRIEVAL" || stage === "SELECTION") {
      // Counts and stable rejection codes only: the same aggregates a successful run report carries.
      deps.log(`PREPARATION_COUNTS discovered=${state.discovered} admitted=${state.repositoriesAdmitted} duplicates=${state.duplicatesRejected}`);
      const rejections = rejectionSummary(state);
      if (rejections.length > 0) deps.log(`PREPARATION_REJECTIONS ${rejections.join(" ")}`);
    }
    deps.log("PREPARATION_FAILED");
    throw new PreparationError();
  }
};
