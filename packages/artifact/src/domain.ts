import type { JsonRecord } from "./validation";

/** The decks an artifact may carry, in this order; a run publishes every deck it could fill. */
export const DECK_IDS = Object.freeze(["project", "language", "before-after", "algorithm", "output"] as const);
export type DeckId = typeof DECK_IDS[number];
export type FixtureKind = "PROJECT" | "LANGUAGE" | "BEFORE_AFTER" | "ALGORITHM" | "OUTPUT";
export const DECK_KINDS: Readonly<Record<DeckId, FixtureKind>> = Object.freeze({
  project: "PROJECT", language: "LANGUAGE", "before-after": "BEFORE_AFTER", algorithm: "ALGORITHM", output: "OUTPUT",
});
export const MODE_KINDS: Readonly<Record<FixtureKind, DeckId>> = Object.freeze({
  PROJECT: "project", LANGUAGE: "language", BEFORE_AFTER: "before-after", ALGORITHM: "algorithm", OUTPUT: "output",
});
export const ARTIFACT_SCHEMA_VERSION = "local-experiment-artifact.v3";
export const CONTENT_CLASS = "LOCAL_UNREVIEWED_EXPERIMENT";
export const PROFILE_VERSION = "local-real-rounds.v4";
/** A session deals this many rounds from a deck's pool. */
export const ROUNDS_PER_SESSION = 5;
/** A deck's pool holds at least one session's rounds and at most this many. */
export const MAXIMUM_POOL_SIZE = 40;
/** The Stack v2 languages the decks draw from, in look-alike pairs: each pair's two languages share a lot of syntax. */
export const STACK_LANGUAGES = Object.freeze([
  "Python", "Ruby", "TypeScript", "JavaScript", "Go", "Rust", "Java", "C#", "Kotlin", "Swift", "C", "C++",
] as const);
export type StackLanguage = typeof STACK_LANGUAGES[number];
/** Each language and the look-alike it is paired with; a language round always offers both. */
export const LANGUAGE_PAIRS: readonly (readonly [StackLanguage, StackLanguage])[] = Object.freeze([
  ["Python", "Ruby"], ["TypeScript", "JavaScript"], ["Go", "Rust"], ["Java", "C#"], ["Kotlin", "Swift"], ["C", "C++"],
].map((pair) => Object.freeze(pair as [StackLanguage, StackLanguage])));
/** Project and language decks hold this many rounds per language; the language deck's option design needs exactly two. */
export const ROUNDS_PER_LANGUAGE = 2;
/** Options per round: four for every kind but before-or-after, which has two. */
export const CANDIDATE_COUNTS: Readonly<Record<FixtureKind, number>> = Object.freeze({
  PROJECT: 4, LANGUAGE: 4, BEFORE_AFTER: 2, ALGORITHM: 4, OUTPUT: 4,
});
/** Before-or-after answers, in pane order: the first names pane A as the later version. */
export const BEFORE_AFTER_CANDIDATE_IDS = Object.freeze([
  "local-experiment.before-after.a-later.v3",
  "local-experiment.before-after.b-later.v3",
] as const);
export const PANE_LABELS = Object.freeze(["A", "B"] as const);
/** Identifier slugs for every language a language round may offer. */
export const LANGUAGE_SLUGS: Readonly<Record<StackLanguage, string>> = Object.freeze({
  Python: "python", Ruby: "ruby", TypeScript: "typescript", JavaScript: "javascript", Go: "go", Rust: "rust",
  Java: "java", "C#": "csharp", Kotlin: "kotlin", Swift: "swift", C: "c", "C++": "cpp",
});

/**
 * Points for a correct answer after zero, one, or two hints. A round with k options is worth 250·k, so
 * guessing at random earns 250 a round on every deck; each hint takes 20% and then 50% of that.
 */
export const HINT_MULTIPLIERS = Object.freeze([1, 0.8, 0.5] as const);
export const roundPoints = (candidateCount: number, hintsUsed: number): number =>
  Math.round(250 * candidateCount * (HINT_MULTIPLIERS[hintsUsed] ?? 0));

export const BASE_SOURCE_KEYS = [
  "discoverySource", "repository", "repositoryUrl", "authorName", "authorLogin",
  "authorBasis", "authorSourceUrl", "path", "blob", "rawContentHash", "excerptHash",
  "licenseName", "licenseSpdx", "licenseFileUrl", "commit", "commitUrl", "blobUrl",
  "profileVersion", "crawlSnapshotId",
] as const;
/** A file chosen from The Stack v2 and revalidated against GitHub: the source of project and language rounds. */
export const STACK_SOURCE_KEYS = [
  ...BASE_SOURCE_KEYS, "stackRelease", "stackRevision", "configuration", "stableRowId",
  "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId",
  "stackRepository", "stackPath", "detectedLicenses", "detectedLanguage", "generated",
  "vendor", "sourceEncoding", "byteLength", "visitDate", "revisionDate", "committerDate",
  "starEventsCount", "forkEventsCount",
] as const;
/** A commit found by GitHub search: one file's parent and child versions. `excerptHash` is the later pane's. */
export const LINEAGE_SOURCE_KEYS = [
  ...BASE_SOURCE_KEYS, "queryId", "childCommit", "childTree", "parentCommit", "parentTree",
  "parentPath", "childPath", "parentMode", "childMode", "parentBlob", "childBlob",
  "parentRawContentHash", "childRawContentHash", "parentExcerptHash", "linesRemoved", "linesAdded",
] as const;
/**
 * A file read from a curated GitHub repository at a pinned commit. Its author is the file's last human author,
 * found in the file's history up to the pin, so `authorSourceUrl` names that author's commit, not the pin.
 */
export const CURATED_SOURCE_KEYS = [...BASE_SOURCE_KEYS, "authorCommit"] as const;
/** An algorithm round's file: which algorithm the repository files it as, its language, and its real name. */
export const ALGORITHM_SOURCE_KEYS = [...CURATED_SOURCE_KEYS, "algorithmId", "language", "functionName"] as const;
/** An output round's file: the function it shows and the doctest call it asks about. */
export const OUTPUT_SOURCE_KEYS = [...CURATED_SOURCE_KEYS, "functionName", "call"] as const;
/** Identities that may not repeat within a deck. */
export const DECK_DEDUPLICATION_KEYS = ["repository", "commit", "path", "blob", "rawContentHash", "excerptHash"] as const;
/** Identities that may not repeat across decks; a repository may. */
export const CROSS_DECK_KEYS = ["commit", "blob", "rawContentHash", "excerptHash"] as const;
/**
 * The same rules per kind. A deck of curated files holds many rounds from one repository at one pinned commit,
 * so its kinds leave `repository` and `commit` out; two kinds compare across decks on the keys both list.
 */
/** A curated file's identities: many rounds may share its repository and pinned commit, never its file. */
const FILE_KEYS = ["path", "blob", "rawContentHash", "excerptHash"] as const;
export const DEDUPLICATION_KEYS_BY_KIND: Readonly<Record<FixtureKind, readonly string[]>> = Object.freeze({
  PROJECT: DECK_DEDUPLICATION_KEYS, LANGUAGE: DECK_DEDUPLICATION_KEYS, BEFORE_AFTER: DECK_DEDUPLICATION_KEYS,
  ALGORITHM: [...FILE_KEYS, "algorithmId"],
  OUTPUT: [...FILE_KEYS],
});
export const CROSS_DECK_KEYS_BY_KIND: Readonly<Record<FixtureKind, readonly string[]>> = Object.freeze({
  PROJECT: CROSS_DECK_KEYS, LANGUAGE: CROSS_DECK_KEYS, BEFORE_AFTER: CROSS_DECK_KEYS,
  ALGORITHM: ["blob", "rawContentHash", "excerptHash"],
  OUTPUT: ["blob", "rawContentHash", "excerptHash"],
});
/** Each kind's panes: one unlabelled pane, or panes `A` and `B`. */
export const PANE_LAYOUTS: Readonly<Record<FixtureKind, readonly (string | null)[]>> = Object.freeze({
  PROJECT: Object.freeze([null]), LANGUAGE: Object.freeze([null]), BEFORE_AFTER: PANE_LABELS, ALGORITHM: Object.freeze([null]),
  OUTPUT: Object.freeze([null]),
});
/** The word an algorithm round's code shows in place of the algorithm's own name (`mystery`, `Mystery`). */
export const MASKED_NAME = "mystery";
/** Kinds whose options may carry a public detail, such as a repository's description. */
export const DETAIL_KINDS: ReadonlySet<FixtureKind> = new Set<FixtureKind>(["PROJECT"]);
/** Source values no pre-answer text may contain as a whole token. */
export const PROTECTED_SOURCE_KEYS = [
  "repository", "repositoryUrl", "authorName", "authorLogin", "authorSourceUrl", "path",
  "blob", "rawContentHash", "licenseName", "licenseSpdx", "licenseFileUrl", "commit",
  "commitUrl", "blobUrl",
] as const;

export interface ParsedSource extends JsonRecord {
  readonly discoverySource: "GITHUB_COMMIT_SEARCH" | "STACK_V2" | "CURATED_GITHUB";
  readonly repository: string;
  readonly authorName: string;
  readonly path: string;
  readonly commit: string;
  readonly blob: string;
  readonly excerptHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly blobUrl: string;
  readonly profileVersion: string;
  readonly crawlSnapshotId: string;
  readonly configuration?: StackLanguage;
  readonly parentExcerptHash?: string;
}

/** A code pane: one for project and language rounds, two labelled `A` and `B` for before-or-after rounds. */
export interface Pane { readonly label: string | null; readonly text: string }
/** An answer option; `detail` is a short public note, such as a repository's description. */
export interface CandidateRecord { readonly id: string; readonly label: string; readonly detail: string | null }

/** One round as the artifact stores it: public text, the answer, the reveal, and its provenance. */
export interface FixtureRecord<Source = Readonly<JsonRecord>> {
  readonly kind: FixtureKind;
  readonly roundId: string;
  readonly roundVersion: string;
  readonly panes: readonly Pane[];
  readonly prompt: string;
  readonly candidates: readonly CandidateRecord[];
  readonly clues: readonly string[];
  readonly correctCandidateId: string;
  readonly evidence: string;
  readonly explanation: string;
  readonly attribution: string;
  readonly helpfulSignals: readonly string[];
  readonly misleadingSignals: readonly string[];
  readonly source: Source;
}
export type ExperimentFixture = FixtureRecord;
export type ParsedFixture = FixtureRecord<Readonly<ParsedSource>>;

/** A deck: its pool of rounds, from which each session deals `roundsPerSession`. */
export interface DeckRecord<Fixture = ExperimentFixture> {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly roundsPerSession: number;
  readonly fixtures: readonly Fixture[];
}
export type ExperimentDeck = DeckRecord;
export type ParsedDeck = DeckRecord<ParsedFixture>;

export interface ExperimentArtifact {
  readonly schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  readonly contentClass: typeof CONTENT_CLASS;
  readonly profileHash: string;
  readonly crawlSnapshot: Readonly<JsonRecord>;
  readonly decks: readonly ExperimentDeck[];
}
