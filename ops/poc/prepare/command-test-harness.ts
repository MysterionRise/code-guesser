import { createRunReport } from "./run-report";
import { readFile } from "node:fs/promises";

import { canonicalBytes, canonicalHash } from "./canonical";
import { createCapacityMeter, type CapacityMeter } from "./capacity";
import type { GitHubQueryClassification } from "./github-search";
import { parseCrawlProfile, STACK_LANGUAGES, type CrawlProfile, type StackLanguage } from "./profile";
import type { PreparationDependencies } from "./index";

const profilePath = new URL("../profiles/local-real-rounds.v2.json", import.meta.url);

export const hash = (digit: string): string => digit.repeat(64);
export const accepted = <Value>(value: Value, digit = "a") => ({
  value,
  acceptedResponseHashes: [hash(digit)],
});
export const loadProfile = async (): Promise<CrawlProfile> =>
  parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));
export const classificationsFor = (
  profile: CrawlProfile,
  incompleteIndex?: number,
): readonly GitHubQueryClassification[] => profile.github.queries.map(({ id }, index) => ({
  queryId: id,
  completeness: index === incompleteIndex ? "PROVIDER_REPORTED_INCOMPLETE" : "COMPLETE",
}));

export interface CommandHarness {
  readonly calls: string[];
  readonly dependencyMeters: CapacityMeter[];
  readonly leases: { accepted: boolean; released: boolean; bytes: number }[];
  readonly dependencies: PreparationDependencies;
  readonly published: unknown[];
  readonly reports: unknown[];
}

interface HarnessState {
  readonly profile: CrawlProfile;
  readonly calls: string[];
  readonly dependencyMeters: CapacityMeter[];
  readonly leases: CommandHarness["leases"];
  readonly published: unknown[];
  readonly reports: unknown[];
  readonly candidates: readonly HarnessCandidate[];
  readonly rows: Readonly<Record<StackLanguage, readonly { id: string; detectedLanguage: string }[]>>;
}

export interface HarnessCandidate { readonly id: number; readonly queryId: string; readonly repository: string }
/** Ordinary candidates 0-7 feed the project deck and uncredited AI rounds; 20-22 carry an AI credit. */
export const HARNESS_CANDIDATES: readonly HarnessCandidate[] = Object.freeze([
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, queryId: "ordinary-facebook", repository: `org${id}/repo-${id}` })),
  ...[20, 21, 22].map((id) => ({ id, queryId: "ai-copilot-github", repository: `org${id}/repo-${id}` })),
]);
export const HARNESS_CREDIT = "Co-authored-by: Copilot <1+Copilot@users.noreply.github.com>";
const harnessRows = (): HarnessState["rows"] => Object.fromEntries(STACK_LANGUAGES.map((language) => [language,
  language === "Python"
    ? [{ id: "py-reject", detectedLanguage: "Python" }, { id: "py", detectedLanguage: "Python" }]
    : [{ id: language.toLowerCase(), detectedLanguage: language }]])) as unknown as HarnessState["rows"];

const makeState = (profile: CrawlProfile): HarnessState => ({
  profile,
  calls: [],
  dependencyMeters: [],
  leases: [],
  published: [],
  reports: [],
  candidates: HARNESS_CANDIDATES,
  rows: harnessRows(),
});

const makeFoundationDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "loadProfile" | "environment" | "createCapacity" | "createRuntime" | "preflight"> => ({
  loadProfile: async () => ({ profile: state.profile, canonicalProfileBytes: canonicalBytes(state.profile) }),
  environment: () => ({ PATH: "/bin", HF_TOKEN: "external-hf", GITHUB_TOKEN: "external-gh" }),
  createCapacity: (configured) => {
    state.calls.push("capacity");
    const actual = createCapacityMeter(configured);
    return Object.freeze({
      ...actual,
      beginBlob: () => {
        const lease = actual.beginBlob();
        const observed = { accepted: false, released: false, bytes: 0 };
        state.leases.push(observed);
        return Object.freeze({
          addBytes: (bytes: number) => { observed.bytes += bytes; lease.addBytes(bytes); },
          accept: () => { observed.accepted = true; lease.accept(); },
          release: () => { observed.released = true; lease.release(); },
        });
      },
    });
  },
  createRuntime: ({ capacity }) => {
    state.calls.push("runtime");
    state.dependencyMeters.push(capacity);
    return Object.freeze({ capacity });
  },
  preflight: async ({ capacity }) => {
    state.calls.push("preflight");
    state.dependencyMeters.push(capacity);
    return accepted({ release: "v2.2.0" }, "1");
  },
});

const makeGitHubDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "searchGitHub" | "bindGitHubLineage" | "admitGitHubCandidate"> => ({
  searchGitHub: async ({ capacity }) => {
    state.calls.push("search");
    state.dependencyMeters.push(capacity);
    return accepted({ candidates: state.candidates, queryClassifications: classificationsFor(state.profile) }, "2");
  },
  bindGitHubLineage: async ({ candidate, capacity }) => {
    state.calls.push(`lineage:${(candidate as any).id}`);
    state.dependencyMeters.push(capacity);
    const id = (candidate as any).id as number;
    return accepted({ ...(candidate as object), excerpt: `value_${id} = compute(${id}) + 1000`,
      commitMessage: id >= 20 ? `Fix spacing\n\n${HARNESS_CREDIT}` : "ordinary refactor" }, "3");
  },
  admitGitHubCandidate: async ({ candidate, capacity }) => {
    state.calls.push(`admit:${(candidate as any).id}`);
    state.dependencyMeters.push(capacity);
    const lineage = candidate as any;
    return accepted({ admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage, source: {
      repository: lineage.repository, commit: String(lineage.id).padStart(40, "c"), path: `src/file-${lineage.id}.ts`,
      blob: String(lineage.id).padStart(40, "b"), rawContentHash: String(lineage.id).padStart(64, "r"),
      excerptHash: String(lineage.id).padStart(64, "e"), queryId: lineage.queryId } }, "4");
  },
});

const makeStackDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "collectStackMetadata" | "fetchStackBlob" | "revalidateStackCandidate" | "validateLanguageCandidate"> => ({
  collectStackMetadata: async ({ configuration, capacity }) => {
    state.calls.push(`metadata:${configuration}`);
    state.dependencyMeters.push(capacity);
    capacity.recordStackRows(configuration, state.rows[configuration].length, 100);
    return accepted(state.rows[configuration], String(5 + STACK_LANGUAGES.indexOf(configuration)));
  },
  fetchStackBlob: async ({ row, limits, capacity }) => {
    state.calls.push(`fetch:${(row as any).id}:${limits.blobAttempts}:${limits.totalBlobBytes}`);
    state.dependencyMeters.push(capacity);
    return accepted({ stableRowId: (row as any).id, byteLength: 80 }, "7");
  },
  revalidateStackCandidate: async ({ row, capacity }) => {
    state.calls.push(`revalidate:${(row as any).id}`);
    state.dependencyMeters.push(capacity);
    return accepted({ ...(row as object) }, "8");
  },
  validateLanguageCandidate: ({ candidate }: any) => {
    state.calls.push(`eligible:${candidate.id}`);
    if (candidate.id === "py-reject") throw new Error("LANGUAGE_ROUNDS_REJECTED");
    return candidate;
  },
});

const makeArtifactDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "generateProject" | "generateLanguage" | "generateAi" | "compose"> => ({
  generateProject: ({ candidates: selected, distractorPool }) => {
    state.calls.push(`project:${selected.length}:${distractorPool.length}`);
    return { fixtures: Array.from({ length: 5 }, () => ({ kind: "PROJECT" })) } as any;
  },
  generateLanguage: ({ candidates: selected }) => {
    state.calls.push(`language:${selected.length}`);
    return { fixtures: Array.from({ length: 5 }, () => ({ kind: "LANGUAGE" })) } as any;
  },
  generateAi: ({ candidates: selected }) => {
    state.calls.push(`ai:${selected.length}`);
    return { fixtures: Array.from({ length: 5 }, () => ({ kind: "AI_CREDIT" })) } as any;
  },
  compose: (options) => {
    state.calls.push(`compose:${options.project.fixtures.length}/${options.language.fixtures.length}/${options.ai.fixtures.length}`);
    const crawlSnapshotId = canonicalHash({ profileHash: canonicalHash(options.profile),
      acceptedResponseHashes: options.acceptedResponseHashes });
    let index = 0;
    const deck = (id: string, generated: { fixtures: readonly unknown[] }) => ({ id, fixtures: generated.fixtures.map((fixture) => {
      index += 1;
      return { ...(fixture as object), source: { repository: `owner/repo-${index}`, commit: String(index % 10).repeat(40), path: `src/file-${index}.ts` } };
    }) });
    return { artifact: { crawlSnapshot: { id: crawlSnapshotId },
      decks: [deck("project", options.project), deck("language", options.language), deck("ai", options.ai)] },
      artifactHash: hash("9"), artifactBytes: new Uint8Array([1]), roundRecordSet: {} } as any;
  },
});

const makeOutputDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "createReport" | "stageReport" | "publishArtifact" | "now" | "uuid" | "log"> => ({
  createReport: (input) => { state.calls.push("report:create"); return createRunReport(input); },
  stageReport: async (report) => {
    state.calls.push("report:stage");
    return {
      commit: async () => { state.calls.push("report:commit"); state.reports.push(report); },
      rollback: async () => {
        state.calls.push("report:rollback");
        const index = state.reports.indexOf(report);
        if (index >= 0) state.reports.splice(index, 1);
      },
      finalize: async () => { state.calls.push("report:finalize"); },
    };
  },
  publishArtifact: async (input) => {
    state.calls.push("publish");
    try {
      await input.beforeCommit?.();
    } catch (error) {
      state.calls.push("publish:rollback");
      throw error;
    }
    state.published.push(input);
    return { path: "artifact", hash: hash("9"), bytes: 1 };
  },
  now: () => new Date("2026-07-31T12:00:00.000Z"),
  uuid: () => "11111111-1111-4111-8111-111111111111",
  log: (message) => { state.calls.push(`log:${message}`); },
});

export const makeHarness = async (
  overrides: Partial<PreparationDependencies> = {},
): Promise<CommandHarness> => {
  const profile = await loadProfile();
  const state = makeState(profile);
  const base: PreparationDependencies = {
    ...makeFoundationDependencies(state),
    ...makeGitHubDependencies(state),
    ...makeStackDependencies(state),
    ...makeArtifactDependencies(state),
    ...makeOutputDependencies(state),
    ...overrides,
  };
  return {
    calls: state.calls,
    dependencyMeters: state.dependencyMeters,
    leases: state.leases,
    dependencies: base,
    published: state.published,
    reports: state.reports,
  };
};
