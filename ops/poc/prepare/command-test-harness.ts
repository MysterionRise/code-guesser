import { LANGUAGE_SLUGS } from "../../../packages/artifact/src/index";
import { createRunReport } from "./run-report";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalBytes, canonicalHash } from "./canonical";
import { createCapacityMeter, type CapacityMeter } from "./capacity";
import type { GitHubQueryClassification } from "./github-search";
import { parseCrawlProfile, poolSizes, STACK_LANGUAGES, type CrawlProfile, type StackLanguage } from "./profile";
import type { PreparationDependencies } from "./index";
import type { FixHarnessData } from "./testdata/deck-builders";

const profilePath = new URL("../profiles/local-real-rounds.v5.json", import.meta.url);

/** A fake SHA-256 made of one repeated digit, or a repeated two-character tag. */
export const hash = (digit: string): string => digit.repeat(64).slice(0, 64);
export const accepted = <Value>(value: Value, digit = "a") => ({
  value,
  acceptedResponseHashes: [hash(digit)],
});
/**
 * The run's profile without its curated section, and with a before-or-after pool of five; the Stack decks hold
 * two rounds per language. Curated decks are tested with the profiles `loadCuratedProfile` builds.
 */
export const loadProfile = async (): Promise<CrawlProfile> => {
  const raw = JSON.parse(await readFile(profilePath, "utf8"));
  delete raw.curated;
  raw.selection = { ...raw.selection, beforeAfterPool: 5 };
  return parseCrawlProfile(raw);
};
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
  readonly rows: Readonly<Record<StackLanguage, readonly HarnessRow[]>>;
  /** Curated files the stub serves, as `owner/name:path` to source text. */
  readonly curatedFiles: ReadonlyMap<string, string>;
  readonly fix: FixHarnessData | undefined;
}

export interface HarnessCandidate { readonly id: number; readonly queryId: string; readonly repository: string; readonly subject: string }
export interface HarnessRow {
  readonly id: string;
  readonly detectedLanguage: string;
  readonly repository: string;
  readonly path: string;
  readonly excerpt: string;
  readonly starEventsCount: number;
  readonly stableRowId?: string;
  readonly detectedLicenses?: readonly string[];
}
/** Eight commits from the profile's searches, two per organisation query in turn. */
export const HARNESS_CANDIDATES: readonly HarnessCandidate[] = Object.freeze(
  [0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, queryId: "refactor-facebook", repository: `org${id}/repo-${id}`, subject: `Refactor helper ${id}` })),
);
/** A popular row (four per language, ranked by star events) or an ordinary row. */
export const harnessRow = (language: string, id: string, overrides: Partial<HarnessRow> = {}): HarnessRow => ({
  id, detectedLanguage: language, repository: `${LANGUAGE_SLUGS[language as StackLanguage] ?? language.toLowerCase()}-org/${id}`,
  // A neutral file name: one that repeated the repository's name would rightly keep it out of a project round.
  path: `src/module${[...id].reduce((total, character, index) => total + character.charCodeAt(0) * (index + 1), 0)}.code`,
  excerpt: "value = compute(1)", starEventsCount: 0, ...overrides,
});
const harnessRows = (): HarnessState["rows"] => Object.fromEntries(STACK_LANGUAGES.map((language) => {
  const slug = LANGUAGE_SLUGS[language];
  const popular = [0, 1, 2, 3].map((rank) => harnessRow(language, `${slug}-pop-${rank}`, { starEventsCount: 9000 - rank * 1000 }));
  // Stable row ids put the ineligible Python row first, so the language deck must reject it and continue.
  const ordinary = language === "Python"
    ? ["py-reject", "py", "py-2", "py-3"].map((id, index) => harnessRow(language, id, { stableRowId: String(index + 1) }))
    : [harnessRow(language, slug), harnessRow(language, `${slug}-2`)];
  return [language, [...popular, ...ordinary]];
})) as unknown as HarnessState["rows"];

const makeState = (profile: CrawlProfile, curatedFiles: ReadonlyMap<string, string> = new Map(), fix?: FixHarnessData): HarnessState => ({
  profile,
  calls: [],
  dependencyMeters: [],
  leases: [],
  published: [],
  reports: [],
  candidates: HARNESS_CANDIDATES,
  rows: harnessRows(),
  curatedFiles,
  fix,
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
): Pick<PreparationDependencies, "searchGitHub" | "screenGitHubRepository" | "describeRepository" | "bindGitHubLineage" | "admitGitHubCandidate"> => ({
  searchGitHub: async ({ capacity }) => {
    state.calls.push("search");
    state.dependencyMeters.push(capacity);
    return accepted({ candidates: state.candidates, queryClassifications: classificationsFor(state.profile) }, "2");
  },
  screenGitHubRepository: async ({ repository, capacity }) => {
    state.calls.push(`screen:${repository}`);
    state.dependencyMeters.push(capacity);
    return accepted({ repository }, "2");
  },
  describeRepository: async ({ repository }) => {
    state.calls.push(`describe:${repository}`);
    return accepted({ description: `About ${repository.split("/")[1]}`, fork: false, archived: false }, "2");
  },
  bindGitHubLineage: async ({ candidate, capacity }) => {
    state.calls.push(`lineage:${(candidate as any).id}`);
    state.dependencyMeters.push(capacity);
    const id = (candidate as any).id as number;
    return accepted({ ...(candidate as object), beforeExcerpt: `total_${id} = sum_all(${id})`, afterExcerpt: `total_${id} = sum(${id})`,
      excerpt: `total_${id} = sum(${id})`, commitMessage: (candidate as any).subject }, "3");
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
): Pick<PreparationDependencies, "collectStackMetadata" | "fetchStackBlob" | "revalidateStackCandidate" | "validateLanguageCandidate"
  | "bindCuratedFile" | "listCuratedDirectory" | "readCuratedFile" | "readDatasetBugs" | "readDatasetBlob" | "bindFixCommit"> => ({
  collectStackMetadata: async ({ configuration, capacity }) => {
    state.calls.push(`metadata:${configuration}`);
    state.dependencyMeters.push(capacity);
    capacity.recordStackRows(configuration, state.rows[configuration].length, 100);
    return accepted(state.rows[configuration], `a${STACK_LANGUAGES.indexOf(configuration).toString(16)}`);
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
  bindCuratedFile: async ({ repository, commit, path, capacity }) => {
    state.calls.push(`curated:${repository}:${path}`);
    state.dependencyMeters.push(capacity);
    const bytes = new TextEncoder().encode(state.curatedFiles.get(`${repository}:${path}`) ?? "");
    if (bytes.byteLength === 0) throw new Error("FILE_PATH");
    return accepted({ repository, commit, path, mode: "100644", blob: createHash("sha1").update(bytes).digest("hex"), bytes,
      rawContentHash: createHash("sha256").update(bytes).digest("hex"), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/${repository}/blob/${commit}/LICENSE`,
      author: { name: "Curated Author", login: "curated-author", commit: "c".repeat(40) } } as any, "6");
  },
  // The served files of one repository directory, as verified trees would list them.
  listCuratedDirectory: async ({ repository, path, capacity }) => {
    state.calls.push(`list:${repository}:${path}`);
    state.dependencyMeters.push(capacity);
    return accepted([...state.curatedFiles.keys()].filter((key) => key.startsWith(`${repository}:${path}/`))
      .map((key) => key.slice(repository.length + 1)).filter((file) => !file.slice(path.length + 1).includes("/")).sort(), "7");
  },
  readCuratedFile: async ({ repository, path, capacity }) => {
    state.calls.push(`read:${repository}:${path}`);
    state.dependencyMeters.push(capacity);
    const bytes = new TextEncoder().encode(state.curatedFiles.get(`${repository}:${path}`) ?? "");
    if (bytes.byteLength === 0) throw new Error("FILE_PATH");
    return accepted({ blob: createHash("sha1").update(bytes).digest("hex"), bytes }, "7");
  },
  readDatasetBugs: async ({ dataset, capacity }) => {
    state.calls.push(`bugs:${dataset.id}`);
    state.dependencyMeters.push(capacity);
    return accepted((state.fix?.bugs ?? []).filter((bug) => bug.dataset === dataset.id), "8");
  },
  readDatasetBlob: async ({ blob, capacity }) => {
    const bug = state.fix?.bugs.find(({ patchBlob }) => patchBlob === blob);
    state.calls.push(bug ? `patch:${bug.bug}` : `record:${blob.slice(0, 8)}`);
    state.dependencyMeters.push(capacity);
    const text = state.fix?.blobs.get(blob);
    if (text === undefined) throw new Error("FIX_DATASET_BLOB");
    return accepted(new TextEncoder().encode(text), "8");
  },
  bindFixCommit: async ({ pointer, capacity }) => {
    state.calls.push(`fix:${pointer.bug}`);
    state.dependencyMeters.push(capacity);
    const fix = state.fix?.fixes.find(({ fixCommit }) => fixCommit === pointer.fixCommit) ?? (() => { throw new Error("FIX_PARENT"); })();
    return accepted({ ...pointer, commit: fix.parent, buggyBlob: createHash("sha1").update(`buggy-${fix.bug}`).digest("hex"),
      fixBlob: createHash("sha1").update(`fixed-${fix.bug}`).digest("hex"), bytes: new TextEncoder().encode(fix.text),
      changedLine: fix.changedLine, licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/${fix.repository}/blob/${fix.parent}/LICENSE`, author: { name: "Fix Author", login: "fix-author" } }, "8");
  },
});

const stubDeck = (kind: string, size: number) => ({ fixtures: Array.from({ length: size }, () => ({ kind })) }) as any;

/** The kind each curated deck's stub rounds carry, and the call it records (`fix-deck`, apart from the fix stubs). */
const CURATED_STUBS = Object.freeze({
  algorithm: { kind: "ALGORITHM", call: "algorithm" },
  output: { kind: "OUTPUT", call: "output" },
  fix: { kind: "FIX", call: "fix-deck" },
  "missing-line": { kind: "MISSING_LINE", call: "missing-line" },
  "name-function": { kind: "NAME_FUNCTION", call: "name-function" },
} as const);

const makeArtifactDependencies = (
  state: HarnessState,
): Pick<PreparationDependencies, "generateProject" | "generateLanguage" | "generateBeforeAfter" | "generateCurated" | "compose"> => ({
  generateProject: ({ profile, rounds }) => {
    state.calls.push(`project:${rounds.length}:${rounds.map((round) => round.distractors.length).join(",")}`);
    return stubDeck("PROJECT", poolSizes(profile).project);
  },
  generateLanguage: ({ profile, candidates: selected }) => {
    state.calls.push(`language:${selected.length}`);
    return stubDeck("LANGUAGE", poolSizes(profile).language);
  },
  generateBeforeAfter: ({ profile, candidates: selected }) => {
    state.calls.push(`before-after:${selected.length}`);
    return stubDeck("BEFORE_AFTER", profile.selection.beforeAfterPool);
  },
  generateCurated: ({ deck, profile, candidates: selected }) => {
    state.calls.push(`${CURATED_STUBS[deck].call}:${selected.length}`);
    return stubDeck(CURATED_STUBS[deck].kind, poolSizes(profile)[deck]);
  },
  compose: (options) => {
    const sizes = (["project", "language", "before-after", ...(["algorithm", "output", "fix"] as const).filter((id) => options.decks[id])] as const)
      .map((id) => options.decks[id]?.fixtures.length ?? 0);
    state.calls.push(`compose:${sizes.join("/")}`);
    const crawlSnapshotId = canonicalHash({ profileHash: canonicalHash(options.profile),
      acceptedResponseHashes: options.acceptedResponseHashes });
    let index = 0;
    const deck = (id: string, generated: { fixtures: readonly unknown[] }) => ({ id, fixtures: generated.fixtures.map((fixture) => {
      index += 1;
      return { ...(fixture as object), source: { repository: `owner/repo-${index}`, commit: String(index % 10).repeat(40), path: `src/file-${index}.ts` } };
    }) });
    return { artifact: { crawlSnapshot: { id: crawlSnapshotId },
      decks: (["project", "language", "before-after", "algorithm", "output", "fix"] as const).filter((id) => options.decks[id] !== undefined).map((id) => deck(id, options.decks[id]!)) },
      artifactHash: hash("9"), artifactBytes: new Uint8Array([1]) } as any;
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
  options: Readonly<{ profile?: CrawlProfile; curatedFiles?: ReadonlyMap<string, string>; fix?: FixHarnessData }> = {},
): Promise<CommandHarness> => {
  const profile = options.profile ?? await loadProfile();
  const state = makeState(profile, options.curatedFiles, options.fix);
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
