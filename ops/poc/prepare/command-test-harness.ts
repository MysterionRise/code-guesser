import { readFile } from "node:fs/promises";

import { canonicalBytes, canonicalHash } from "./canonical";
import { createCapacityMeter, type CapacityMeter } from "./capacity";
import type { GitHubQueryClassification } from "./github-search";
import { parseCrawlProfile, type CrawlProfile } from "./profile";
import type { PreparationDependencies } from "./index";

const profilePath = new URL("../profiles/local-real-rounds.v1.json", import.meta.url);

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
  readonly candidates: readonly { id: number }[];
  readonly rows: Readonly<Record<"Python" | "TypeScript", readonly { id: string; detectedLanguage: string }[]>>;
}

const makeState = (profile: CrawlProfile): HarnessState => ({
  profile,
  calls: [],
  dependencyMeters: [],
  leases: [],
  published: [],
  reports: [],
  candidates: [0, 1, 2, 3, 4].map((id) => ({ id })),
  rows: {
    Python: [{ id: "py-reject", detectedLanguage: "Python" }, { id: "py", detectedLanguage: "Python" }],
    TypeScript: [{ id: "ts", detectedLanguage: "TypeScript" }],
  },
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
    return accepted({ ...(candidate as object), commitMessage: (candidate as any).id === 0
      ? state.profile.markers[0] : "ordinary refactor" }, "3");
  },
  admitGitHubCandidate: async ({ candidate, capacity }) => {
    state.calls.push(`admit:${(candidate as any).id}`);
    state.dependencyMeters.push(capacity);
    return accepted({ admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage: candidate }, "4");
  },
});

const makeStackDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "collectStackMetadata" | "fetchStackBlob" | "revalidateStackCandidate" | "validateLanguageCandidate"> => ({
  collectStackMetadata: async ({ configuration, capacity }) => {
    state.calls.push(`metadata:${configuration}`);
    state.dependencyMeters.push(capacity);
    capacity.recordStackRows(configuration, state.rows[configuration].length, 100);
    return accepted(state.rows[configuration], configuration === "Python" ? "5" : "6");
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
): Pick<PreparationDependencies, "generateProvenance" | "generateLanguage" | "compose"> => ({
  generateProvenance: ({ candidates: selected }) => {
    state.calls.push(`provenance:${selected.length}`);
    return { fixtures: [{ kind: "PROVENANCE" }, { kind: "PROVENANCE" }, { kind: "PROVENANCE" }] } as any;
  },
  generateLanguage: ({ candidates: selected }) => {
    state.calls.push(`language:${selected.length}`);
    return { fixtures: [{ kind: "LANGUAGE" }, { kind: "LANGUAGE" }] } as any;
  },
  compose: (options) => {
    state.calls.push(`compose:${options.provenance.fixtures.length}/${options.language.fixtures.length}`);
    const crawlSnapshotId = canonicalHash({ profileHash: canonicalHash(options.profile),
      acceptedResponseHashes: options.acceptedResponseHashes });
    const fixtures = [...options.provenance.fixtures, ...options.language.fixtures].map((fixture, index) => ({
      ...fixture, source: { repository: `owner/repo-${index}`, commit: String(index + 1).repeat(40), path: `src/file-${index}.ts` },
    }));
    return { artifact: { crawlSnapshot: { id: crawlSnapshotId }, fixtures },
      artifactHash: hash("9"), artifactBytes: new Uint8Array([1]), roundRecordSet: {} } as any;
  },
});

const makeOutputDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "createReport" | "stageReport" | "publishArtifact" | "now" | "uuid" | "log"> => ({
  createReport: (input) => { state.calls.push("report:create"); return input as any; },
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
