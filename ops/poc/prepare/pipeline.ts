import { canonicalHash } from "./canonical";
import type { CapacityMeter } from "./capacity";
import type { ComposedExperiment } from "./compose";
import { defaultDependencies } from "./dependencies";
import {
  createDeckAttempts, createRunState, failureDiagnostic, failureSite, noteRejection, PreparationError, rejectionSummary,
  reportedFailure, uncodedDiagnostic, type DeckOutcome, type FailureStage, type RunState,
} from "./diagnostics";
import type { GitHubQueryClassification } from "./github-search";
import { artifactFixtures, DECK_IDS, type DeckId } from "./model";
import { STACK_LANGUAGES, poolSizes, type CrawlProfile } from "./profile";
import { selectAlgorithm, type AlgorithmSelection } from "./select-algorithm";
import { selectOutput, type OutputSelection } from "./select-output";
import { selectFix, type FixSelection } from "./select-fix";
import { selectBeforeAfter } from "./select-github";
import { selectStack, type ProjectSelection } from "./select-stack";
import { addHashes, protectedValuesOf, provisionalSnapshot, repositoryScreen, safeDescription, view } from "./selection";
import type { GeneratedRounds } from "./round-helpers";
import type { RevalidatedStackCandidate } from "./stack-revalidation";
import type { Context, FailureReport, PreparationDependencies, PreparationResult } from "./types";

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
    schemaVersion: "local-experiment-run.v3", executionId, observedAt, profileVersion: context.profile.profileVersion,
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

const failureReport = (
  deps: PreparationDependencies,
  failure: Readonly<{ stage: string; code: string; statusClass: string; site: string | undefined }>,
  state: RunState,
  spent: readonly (readonly [string, number])[],
  snapshot: ReturnType<CapacityMeter["snapshot"]> | undefined,
  journal: string | undefined,
): FailureReport => Object.freeze({
  schemaVersion: "local-experiment-failure.v1",
  executionId: deps.uuid(),
  observedAt: deps.now().toISOString(),
  stage: failure.stage,
  code: failure.code,
  statusClass: failure.statusClass,
  site: failure.site ?? null,
  spend: Object.fromEntries(spent),
  counts: { discovered: state.discovered, repositoriesAdmitted: state.repositoriesAdmitted, githubRevalidations: state.githubRevalidations,
    screened: state.screened, duplicatesRejected: state.duplicatesRejected },
  capacity: snapshot ? {
    requests: snapshot.requestCount, responseBytes: snapshot.responseBytes, github: snapshot.github, stackRows: snapshot.stackRows,
    stackMetadataBytes: snapshot.stackMetadataBytes, blobAttempts: snapshot.blobAttempts, blobsRetrieved: snapshot.successfulBlobs,
    blobBytes: snapshot.totalBlobBytes, retries: snapshot.retryWaits, waitedMilliseconds: snapshot.waitedMilliseconds,
  } : null,
  rejections: [...state.diagnostics].map(([key, count]) => { const [stage, reasonCode] = key.split("\0") as [string, string]; return { stage, reasonCode, count }; }),
  journal: journal ?? null,
});

export class DeckSelectionError extends Error {
  public constructor(public readonly code: string) { super(code); this.name = "DeckSelectionError"; }
}

/**
 * The decks this run publishes: every deck that filled. Each skipped deck is logged with its reason and
 * counted in the rejection aggregates; a run that filled none fails with the shared reason, if any.
 */
const publishedDecks = (deps: PreparationDependencies, state: RunState, outcomes: Readonly<Partial<Record<DeckId, DeckOutcome>>>): readonly DeckId[] => {
  // A deck the profile does not configure has no outcome: it is neither published nor skipped.
  const attempted = DECK_IDS.filter((id) => outcomes[id] !== undefined);
  const skipped = attempted.filter((id) => outcomes[id]!.skipped !== undefined);
  for (const id of skipped) {
    deps.log(`PREPARATION_DECK_SKIPPED ${id} ${outcomes[id]!.skipped}`);
    noteRejection(state, "SELECTION", new Error(`${id.toUpperCase().replaceAll("-", "_")}_DECK_SKIPPED`));
  }
  const published = attempted.filter((id) => outcomes[id]!.skipped === undefined);
  if (published.length === 0) {
    const reasons = new Set(skipped.map((id) => outcomes[id]!.skipped));
    throw new DeckSelectionError(reasons.size === 1 ? [...reasons][0]! : "NO_DECK_FILLED");
  }
  return published;
};

/** Stages that run once candidates are being selected: a failure in one logs the selection counts and rejection aggregates. */
const COUNTED_STAGES: ReadonlySet<FailureStage> = new Set(["ADMISSION", "BLOB_RETRIEVAL", "CURATED_FILES", "SELECTION", "GENERATION", "REPORT"]);

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
  const spent = (): [FailureStage, number][] => [...spend].filter(([, requests]) => requests > 0);
  return {
    current: (): FailureStage => stage,
    meter: (value: CapacityMeter): void => { meter = value; },
    snapshot: () => meter?.snapshot(),
    spent,
    enter,
    spendLine: (): string | undefined => {
      if (!meter) return undefined;
      enter(stage);
      return `PREPARATION_SPEND ${spent().map(([name, requests]) => `${name}=${requests} `).join("")}total=${meter.snapshot().requestCount}`;
    },
  };
};

export const prepareLocalExperiment = async (deps: PreparationDependencies = defaultDependencies()): Promise<PreparationResult> => {
  const state = createRunState();
  const tracker = createStageTracker();
  const logSpend = (): void => { const line = tracker.spendLine(); if (line) deps.log(line); };
  let runtime: unknown;
  const finishRuntime = (): string | undefined => {
    if (runtime === undefined || !deps.finishRuntime) return undefined;
    let line: string | undefined;
    try { line = deps.finishRuntime(runtime); } catch { line = "PREPARATION_JOURNAL_FAILED"; }
    if (line) deps.log(line);
    return line;
  };
  try {
    const loaded = await deps.loadProfile();
    const profileHash = canonicalHash(loaded.profile);
    if (canonicalHash(JSON.parse(new TextDecoder().decode(loaded.canonicalProfileBytes))) !== profileHash) throw new PreparationError();
    const environment = deps.environment();
    const capacity = deps.createCapacity({ limits: loaded.profile.capacity,
      githubQueryIds: loaded.profile.github.queries.map(({ id }) => id), stackLanguages: STACK_LANGUAGES });
    tracker.meter(capacity);
    runtime = deps.createRuntime({ profile: loaded.profile, environment, capacity });
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
    const attempt = createDeckAttempts();
    const beforeAfter = await selectBeforeAfter(context, deps, hashes, search.value.candidates, state, screenRepository, attempt, () => []);
    tracker.enter("BLOB_RETRIEVAL");
    const stack = await selectStack(context, deps, hashes, metadata, state, screenRepository, attempt, () => beforeAfter.candidates ?? []);
    // Curated decks run last, so a run-wide budget they spend can skip only them.
    const earlierDecks = (): readonly unknown[] => [...(beforeAfter.candidates ?? []),
      ...[...(stack.project.candidates ?? []), ...(stack.language.candidates ?? [])].map(({ candidate }) => candidate)];
    let algorithm: DeckOutcome<AlgorithmSelection> | undefined;
    let output: DeckOutcome<OutputSelection> | undefined;
    if (loaded.profile.curated?.algorithm) {
      tracker.enter("CURATED_FILES");
      algorithm = await selectAlgorithm(context, deps, hashes, state, attempt, earlierDecks);
    }
    if (loaded.profile.curated?.output) {
      tracker.enter("CURATED_FILES");
      output = await selectOutput(context, deps, hashes, state, attempt, () => [...earlierDecks(), ...(algorithm?.candidates ?? [])]);
    }
    let fix: DeckOutcome<FixSelection> | undefined;
    if (loaded.profile.curated?.fix) {
      tracker.enter("CURATED_FILES");
      fix = await selectFix(context, deps, hashes, state, attempt,
        () => [...earlierDecks(), ...(algorithm?.candidates ?? []), ...(output?.candidates ?? [])]);
    }
    tracker.enter("SELECTION");
    const outcomes: Readonly<Partial<Record<DeckId, DeckOutcome>>> = {
      project: stack.project, language: stack.language, "before-after": beforeAfter, ...(algorithm ? { algorithm } : {}),
      ...(output ? { output } : {}), ...(fix ? { fix } : {}),
    };
    const published = publishedDecks(deps, state, outcomes);
    tracker.enter("GENERATION");
    const crawlSnapshotId = provisionalSnapshot(profileHash, hashes);
    const projectSelections: readonly ProjectSelection[] = stack.project.candidates ?? [];
    const languageSelections = stack.language.candidates ?? [];
    const finalized = deps.finalizeBindings
      ? await deps.finalizeBindings({ ...context, crawlSnapshotId, beforeAfterCandidates: beforeAfter.candidates ?? [],
        projectSelections, languageSelections })
      : { beforeAfterCandidates: beforeAfter.candidates ?? [], projectCandidates: projectSelections.map(({ candidate }) => candidate),
        languageCandidates: languageSelections.map(({ candidate }) => candidate) };
    if (deps.finalizeBindings && (finalized.beforeAfterCandidates.some((candidate) => view(candidate).source?.crawlSnapshotId !== crawlSnapshotId)
      || [...finalized.projectCandidates, ...finalized.languageCandidates]
        .some((candidate) => (candidate as { crawlSnapshotId?: unknown }).crawlSnapshotId !== crawlSnapshotId))) throw new PreparationError();
    // A curated file's source is built from the selection itself, so binding it to the final snapshot needs no request.
    const algorithmCandidates = (algorithm?.candidates ?? []).map((selection) => Object.freeze({ ...selection, crawlSnapshotId }));
    const outputCandidates = (output?.candidates ?? []).map((selection) => Object.freeze({ ...selection, crawlSnapshotId }));
    const fixCandidates = (fix?.candidates ?? []).map((selection) => Object.freeze({ ...selection, crawlSnapshotId }));
    const generate: Readonly<Record<DeckId, () => GeneratedRounds>> = {
      project: () => {
        // Descriptions are public; one that names any selected source's protected value is left out.
        const protectedValues = protectedValuesOf([...finalized.beforeAfterCandidates, ...finalized.projectCandidates, ...finalized.languageCandidates]);
        return deps.generateProject({ profile: loaded.profile, rounds: projectSelections.map((selection, index) => ({
          candidate: finalized.projectCandidates[index] as RevalidatedStackCandidate,
          description: safeDescription(selection.description, protectedValues),
          distractors: selection.distractors.map((option) => ({ ...option, description: safeDescription(option.description, protectedValues) })),
        })) });
      },
      language: () => deps.generateLanguage({ profile: loaded.profile, candidates: finalized.languageCandidates }),
      "before-after": () => deps.generateBeforeAfter({ profile: loaded.profile, candidates: finalized.beforeAfterCandidates }),
      algorithm: () => deps.generateAlgorithm({ profile: loaded.profile, candidates: algorithmCandidates }),
      output: () => deps.generateOutput({ profile: loaded.profile, candidates: outputCandidates }),
      fix: () => deps.generateFix({ profile: loaded.profile, candidates: fixCandidates }),
    };
    const expected = poolSizes(loaded.profile);
    const decks = Object.fromEntries(published.map((id) => {
      const generated = generate[id]();
      if (generated.fixtures.length !== expected[id]) throw new PreparationError();
      return [id, generated];
    }));
    const composed = deps.compose({ profile: loaded.profile, canonicalProfileBytes: loaded.canonicalProfileBytes,
      acceptedResponseHashes: Object.freeze(hashes), decks });
    if (composed.artifact.crawlSnapshot.id !== crawlSnapshotId) throw new PreparationError();
    tracker.enter("REPORT");
    const report = deps.createReport(reportInput(context, composed, deps.uuid(), deps.now().toISOString(), state, classifications));
    tracker.enter("PUBLICATION");
    const publication = await publishWithReport(deps, composed, report);
    if (classifications.some(({ completeness }) => completeness === "PROVIDER_REPORTED_INCOMPLETE")) deps.log("GITHUB_SEARCH_INCOMPLETE");
    deps.log(`PREPARATION_DECKS ${published.join(",")}`);
    logSpend();
    finishRuntime();
    deps.log("PREPARATION_COMPLETE");
    return Object.freeze({ artifactHash: composed.artifactHash, crawlSnapshotId, publication });
  } catch (error) {
    const stage = tracker.current();
    // A retry wrapper is reported as the failure it wrapped: a revoked token is UNSUPPORTED_STATUS 4xx.
    const failure = reportedFailure(error);
    const diagnostic = failureDiagnostic(failure) ?? uncodedDiagnostic(failure);
    deps.log(`PREPARATION_STAGE_FAILED ${stage} ${diagnostic.code} ${diagnostic.statusClass}`);
    const site = failureSite(failure);
    if (site) deps.log(`PREPARATION_FAILURE_SITE ${site}`);
    logSpend();
    if (COUNTED_STAGES.has(stage)) {
      // Counts and stable rejection codes only: the same aggregates a successful run report carries.
      deps.log(`PREPARATION_COUNTS discovered=${state.discovered} admitted=${state.repositoriesAdmitted} duplicates=${state.duplicatesRejected}`);
      const rejections = rejectionSummary(state);
      if (rejections.length > 0) deps.log(`PREPARATION_REJECTIONS ${rejections.join(" ")}`);
    }
    const journal = finishRuntime();
    if (deps.writeFailureReport) {
      try {
        await deps.writeFailureReport(failureReport(deps, { stage, ...diagnostic, site }, state, tracker.spent(), tracker.snapshot(), journal));
      } catch { deps.log("PREPARATION_FAILURE_REPORT_FAILED"); }
    }
    deps.log("PREPARATION_FAILED");
    throw new PreparationError();
  }
};
