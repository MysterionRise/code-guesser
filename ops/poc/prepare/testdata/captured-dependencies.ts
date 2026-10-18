import { publishArtifact } from "../artifact-store";
import { canonicalBytes, canonicalHash } from "../canonical";
import { createCapacityMeter, type CapacityMeter } from "../capacity";
import { composeExperimentArtifact } from "../compose";
import { curatedDeck } from "../curated-decks";
import { readAdvisories, readAdvisoryFix } from "../github-advisories";
import { bindFixCommit, readDatasetBlob, readDatasetBugs } from "../github-fixes";
import { generateBeforeAfterRounds } from "../before-after-rounds";
import { bindGitHubFile, listGitHubDirectory, readGitHubFile } from "../github-files";
import { admitGitHubCandidates, describeGitHubRepository, screenGitHubRepository } from "../github-admission";
import { bindGitHubLineage } from "../github-lineage";
import { crawlGitHubCommitSearch } from "../github-search";
import { createPreparationRuntime, type PreparationDependencies } from "../index";
import { generateLanguageRounds, validateLanguageCandidate } from "../language-rounds";
import { generateProjectRounds } from "../project-rounds";
import { RetryRequestError } from "../retry";
import { createRunReport } from "../run-report";
import { preflightStackAccess } from "../stack-access";
import { collectStackMetadata, type StackMetadataRow } from "../stack-metadata";
import { revalidateStackCandidate, type SelectedStackBlob } from "../stack-revalidation";
import type { BoundedTransport } from "../transport";
import type { CrawlProfile } from "../profile";
import type { StackSelection } from "../types";
import type { CapturedResponses } from "./captured-responses";

export type CapturedFailure =
  | "malformed" | "capacity" | "freshness" | "credential"
  | "redirect" | "retry" | "cleanup" | "insufficient";

export interface CapturedDependencyState {
  readonly profile: CrawlProfile;
  readonly captures: CapturedResponses;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly artifactPath: string;
  readonly observedAt: string;
  readonly executionId: string;
  readonly failure?: CapturedFailure;
  readonly events: string[];
  readonly logs: string[];
  readonly reports: Uint8Array[];
  readonly requests: string[];
  readonly metadataConfigurations: string[];
  readonly selectedBlobRows: string[];
  cleanups: number;
}

interface CapturedRuntime {
  readonly hashes: string[];
  transport: BoundedTransport;
  readonly retry: { execute<Value>(operation: () => Promise<Value>): Promise<Value> };
  beginReplay(): void;
}

interface RuntimeReference { current?: CapturedRuntime }
const REVISION_URL =
  "https://huggingface.co/api/datasets/bigcode/the-stack-v2/revision/e565caa3a78c2423bd374333a472b049eb090e47";
const copy = <Value>(value: Value): Value => structuredClone(value);
const runtimeOf = (reference: RuntimeReference): CapturedRuntime =>
  reference.current ?? (() => { throw new Error("CAPTURE_RUNTIME_MISSING"); })();
const stage = async <Value>(runtime: CapturedRuntime, operation: () => Promise<Value>) => {
  const offset = runtime.hashes.length;
  const value = await operation();
  return Object.freeze({ value, acceptedResponseHashes: Object.freeze(runtime.hashes.slice(offset)) });
};
const record = async <Value>(state: CapturedDependencyState, name: string, operation: () => Promise<Value>) => {
  state.events.push(`${name}:start`);
  try {
    const value = await operation();
    state.events.push(`${name}:complete`);
    return value;
  } catch (error) {
    state.events.push(`${name}:${error instanceof Error ? error.message : "UNKNOWN"}`);
    throw error;
  }
};

const responseValue = (state: CapturedDependencyState, url: string): unknown => {
  const value = state.captures.http.get(url);
  if (value === undefined) throw new Error("CAPTURE_MISSING");
  if (state.failure === "freshness" && url === REVISION_URL) return { ...(value as object), sha: "0".repeat(40) };
  if (state.failure === "malformed" && url.includes("/search/commits")) return { unexpected: true };
  if (state.failure === "insufficient" && url.includes("/search/commits")
    && new URL(url).searchParams.get("q") === state.profile.github.queries[1]!.query) {
    return { total_count: 0, incomplete_results: false, items: [] };
  }
  return copy(value);
};

const capturedFetch = (state: CapturedDependencyState): typeof fetch => async (input, init) => {
  const url = input.toString();
  state.requests.push(url);
  if (state.failure === "redirect" && url === REVISION_URL) {
    return new Response(null, { status: 302, headers: { location: "https://example.test/escape" } });
  }
  const value = responseValue(state, url);
  const body = typeof value === "string" ? value : JSON.stringify(value);
  const contentType = typeof value === "string" ? "text/plain; charset=utf-8" : "application/json";
  if (init?.redirect !== "manual" || init.method !== "GET") throw new Error("CAPTURE_POLICY_REJECTED");
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
};

const retryTransport = (transport: BoundedTransport): BoundedTransport => Object.freeze({
  requestJson: (input: Parameters<BoundedTransport["requestJson"]>[0], page?: number) =>
    input.url.includes("/search/commits")
      ? Promise.reject(new RetryRequestError(1)) : transport.requestJson(input, page),
  requestBytes: (input: Parameters<BoundedTransport["requestBytes"]>[0], page?: number) =>
    transport.requestBytes(input, page),
});

const capturedCapacity = (
  state: CapturedDependencyState,
  options: Parameters<typeof createCapacityMeter>[0],
): CapacityMeter => {
  const capacity = createCapacityMeter(options);
  if (state.failure !== "capacity") return capacity;
  return Object.freeze({ ...capacity, beginBlob: () => {
    try { return capacity.beginBlob(); } catch (error) {
      state.events.push(`capacity:${error instanceof Error ? error.message : "UNKNOWN"}`);
      throw error;
    }
  } });
};

const bootstrapLane = (
  state: CapturedDependencyState, reference: RuntimeReference,
): Pick<PreparationDependencies, "loadProfile" | "environment" | "createCapacity" | "createRuntime"> => ({
  loadProfile: async () => ({ profile: state.profile, canonicalProfileBytes: canonicalBytes(state.profile) }),
  environment: () => state.environment,
  createCapacity: (options) => capturedCapacity(state, options),
  createRuntime: ({ capacity }) => {
    const runtime = createPreparationRuntime(state.profile, state.environment, capacity,
      capturedFetch(state)) as CapturedRuntime;
    if (state.failure === "retry") runtime.transport = retryTransport(runtime.transport);
    reference.current = runtime;
    return runtime;
  },
});

const discoveryLane = (
  state: CapturedDependencyState, reference: RuntimeReference,
): Pick<PreparationDependencies, "preflight" | "searchGitHub"> => ({
  preflight: (context) => record(state, "preflight", () => {
    const acknowledgedUsableRevision = context.environment.STACK_V2_ACKNOWLEDGED_USABLE_REVISION;
    if (!acknowledgedUsableRevision) throw new Error("ACKNOWLEDGEMENT_MISSING");
    const runtime = runtimeOf(reference);
    return stage(runtime, () => preflightStackAccess({
      profile: context.profile, acknowledgedUsableRevision, transport: runtime.transport,
    }));
  }),
  searchGitHub: (context) => record(state, "github-search", async () => {
    const runtime = runtimeOf(reference);
    const result = await stage(runtime, () => crawlGitHubCommitSearch({
      profile: context.profile, transport: runtime.transport, retry: runtime.retry,
    }));
    if (state.failure === "insufficient") state.events.push(`github-search:candidates-${result.value.candidates.length}`);
    return result;
  }),
});

const githubLane = (
  state: CapturedDependencyState, reference: RuntimeReference,
): Pick<PreparationDependencies, "screenGitHubRepository" | "describeRepository" | "bindGitHubLineage" | "admitGitHubCandidate"> => ({
  screenGitHubRepository: (context) => record(state, "github-repository", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, async () => {
      await screenGitHubRepository({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context.repository);
      return context.repository;
    });
  }),
  describeRepository: (context) => record(state, "github-description", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => describeGitHubRepository({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context.repository));
  }),
  bindGitHubLineage: (context) => record(state, "github-lineage", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, async () => (await bindGitHubLineage({ profile: context.profile,
      candidates: [context.candidate as any], transport: runtime.transport, retry: runtime.retry }))[0]!);
  }),
  admitGitHubCandidate: (context) => record(state, "github-admission", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, async () => (await admitGitHubCandidates({ profile: context.profile,
      profileHash: context.profileHash, crawlSnapshotId: context.crawlSnapshotId,
      candidates: [context.candidate as any], transport: runtime.transport, retry: runtime.retry }))[0]!);
  }),
});

const metadataCounters = (rows: number) => ({ counters: { networkBytes: 2048, peakTemporaryDiskBytes: 512, redirectsFollowed: 0, requests: 2, rowsInspected: rows } });
const metadataOutput = (rows: readonly StackMetadataRow[]): Uint8Array =>
  Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n${JSON.stringify(metadataCounters(rows.length))}\n`);
const stackLane = (
  state: CapturedDependencyState, reference: RuntimeReference,
): Pick<PreparationDependencies, "collectStackMetadata" | "fetchStackBlob"
  | "revalidateStackCandidate" | "validateLanguageCandidate" | "bindCuratedFile" | "listCuratedDirectory" | "readCuratedFile"
  | "readDatasetBugs" | "readDatasetBlob" | "readAdvisories" | "readAdvisoryFix" | "bindFixCommit"> => ({
  collectStackMetadata: (context) => record(state, `stack-metadata-${context.configuration}`, async () => {
    state.metadataConfigurations.push(context.configuration);
    const value = await collectStackMetadata({ profile: context.profile, capacity: context.capacity,
      configuration: context.configuration, rowLimit: state.captures.metadata[context.configuration].length, environment: context.environment,
      blobAccess: async () => undefined, runWorker: async () => ({
        exitCode: state.failure === "cleanup" ? 1 : 0,
        stdout: state.failure === "cleanup" ? new Uint8Array()
          : metadataOutput(state.captures.metadata[context.configuration]),
        stderr: new Uint8Array(), cleanup: async () => { state.cleanups += 1; },
      }) });
    return Object.freeze({ value, acceptedResponseHashes: Object.freeze([canonicalHash(value)]) });
  }),
  fetchStackBlob: (context) => record(state, "stack-blob", async () => {
    const row = context.row as StackMetadataRow;
    state.selectedBlobRows.push(row.stableRowId);
    const value = copy(state.captures.selectedBlobs.get(row.stableRowId) as SelectedStackBlob);
    return Object.freeze({ value, acceptedResponseHashes: Object.freeze([canonicalHash(value)]) });
  }),
  revalidateStackCandidate: (context) => record(state, "stack-revalidation", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => revalidateStackCandidate({ profile: context.profile,
      profileHash: context.profileHash, crawlSnapshotId: context.crawlSnapshotId,
      metadata: context.row as StackMetadataRow, selectedBlob: context.blob as SelectedStackBlob,
      transport: runtime.transport, retry: runtime.retry }));
  }),
  validateLanguageCandidate: (context) => validateLanguageCandidate({
    profile: context.profile, candidate: context.candidate as any,
  }),
  bindCuratedFile: (context) => record(state, "curated-file", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => bindGitHubFile({ profile: context.profile, profileHash: context.profileHash,
      transport: runtime.transport, retry: runtime.retry }, context));
  }),
  listCuratedDirectory: (context) => record(state, "curated-list", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => listGitHubDirectory({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context));
  }),
  readCuratedFile: (context) => record(state, "curated-read", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => readGitHubFile({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context));
  }),
  readDatasetBugs: (context) => record(state, "dataset-bugs", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => readDatasetBugs({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context.dataset));
  }),
  readDatasetBlob: (context) => record(state, "dataset-blob", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => readDatasetBlob({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context));
  }),
  readAdvisories: (context) => record(state, "advisories", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => readAdvisories({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context));
  }),
  readAdvisoryFix: (context) => record(state, "advisory-fix", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => readAdvisoryFix({ profile: context.profile, transport: runtime.transport, retry: runtime.retry }, context));
  }),
  bindFixCommit: (context) => record(state, "fix-commit", () => {
    const runtime = runtimeOf(reference);
    return stage(runtime, () => bindFixCommit({ profile: context.profile, profileHash: context.profileHash,
      transport: runtime.transport, retry: runtime.retry }, context.pointer));
  }),
});

const finalizeLane = (
  state: CapturedDependencyState, reference: RuntimeReference,
): Pick<PreparationDependencies, "finalizeBindings"> => ({
  finalizeBindings: (context) => record(state, "finalize", async () => {
    const runtime = runtimeOf(reference);
    runtime.beginReplay();
    const revalidate = (selections: readonly StackSelection[]) => Promise.all(selections.map(({ row, blob }) =>
      revalidateStackCandidate({ profile: context.profile, profileHash: context.profileHash,
        crawlSnapshotId: context.crawlSnapshotId, metadata: row as StackMetadataRow,
        selectedBlob: blob as SelectedStackBlob, transport: runtime.transport, retry: runtime.retry })));
    const beforeAfterCandidates = await Promise.all(context.beforeAfterCandidates.map(async (candidate: any) =>
      (await admitGitHubCandidates({ profile: context.profile, profileHash: context.profileHash,
        crawlSnapshotId: context.crawlSnapshotId, candidates: [candidate.lineage],
        transport: runtime.transport, retry: runtime.retry }))[0]!));
    return Object.freeze({ beforeAfterCandidates: Object.freeze(beforeAfterCandidates),
      projectCandidates: Object.freeze(await revalidate(context.projectSelections)),
      languageCandidates: Object.freeze(await revalidate(context.languageSelections)) });
  }),
});

const outputLane = (state: CapturedDependencyState): Pick<PreparationDependencies,
  "generateProject" | "generateLanguage" | "generateBeforeAfter" | "generateCurated" | "compose"
  | "createReport" | "stageReport"
  | "publishArtifact" | "now" | "uuid" | "log"> => ({
  generateProject: (context) => generateProjectRounds(context as any),
  generateLanguage: (context) => generateLanguageRounds(context as any),
  generateBeforeAfter: (context) => generateBeforeAfterRounds(context as any),
  generateCurated: ({ deck, ...context }) => curatedDeck(deck).generate(context),
  compose: composeExperimentArtifact,
  createReport: createRunReport,
  stageReport: async (report) => {
    state.events.push("report");
    const bytes = canonicalBytes(report);
    return Object.freeze({
      commit: async () => { state.events.push("report:commit"); state.reports.push(bytes); },
      rollback: async () => {
        state.events.push("report:rollback");
        const index = state.reports.indexOf(bytes);
        if (index >= 0) state.reports.splice(index, 1);
      },
      finalize: async () => { state.events.push("report:finalize"); },
    });
  },
  publishArtifact: ({ artifact, expectedHash, beforeCommit }) => record(state, "publish", () => publishArtifact({
    artifact, expectedHash, targetPath: state.artifactPath, uniqueId: () => "captured-publication",
    ...(beforeCommit ? { beforeCommit } : {}),
  })),
  now: () => new Date(state.observedAt),
  uuid: () => state.executionId,
  log: (message) => { state.events.push(`log:${message}`); state.logs.push(message); },
});

export const createCapturedDependencies = (state: CapturedDependencyState): PreparationDependencies => {
  const reference: RuntimeReference = {};
  return Object.freeze({
    ...bootstrapLane(state, reference),
    ...discoveryLane(state, reference),
    ...githubLane(state, reference),
    ...stackLane(state, reference),
    ...finalizeLane(state, reference),
    ...outputLane(state),
  });
};
