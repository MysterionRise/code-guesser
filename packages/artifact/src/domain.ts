import type { JsonRecord } from "./validation";

/** The decks an artifact may carry, in this order; a run publishes every deck it could fill. */
export const DECK_IDS = Object.freeze(["project", "language", "ai"] as const);
export type DeckId = typeof DECK_IDS[number];
export type FixtureKind = "PROJECT" | "LANGUAGE" | "AI_CREDIT";
export const DECK_KINDS: Readonly<Record<DeckId, FixtureKind>> = Object.freeze({
  project: "PROJECT", language: "LANGUAGE", ai: "AI_CREDIT",
});
export const MODE_KINDS: Readonly<Record<FixtureKind, DeckId>> = Object.freeze({
  PROJECT: "project", LANGUAGE: "language", AI_CREDIT: "ai",
});
export const ROUNDS_PER_DECK = 5;
export const ARTIFACT_SCHEMA_VERSION = "local-experiment-artifact.v2";
export const CONTENT_CLASS = "LOCAL_UNREVIEWED_EXPERIMENT";
export const PROFILE_VERSION = "local-real-rounds.v2";
export const STACK_LANGUAGES = Object.freeze(["Python", "TypeScript", "Go", "Rust", "Ruby"] as const);
export type StackLanguage = typeof STACK_LANGUAGES[number];
export const AI_CANDIDATE_IDS = Object.freeze([
  "local-experiment.ai-credit-recorded.v2",
  "local-experiment.ai-credit-absent.v2",
] as const);
/** The language-round candidate universe: the five answers and every distractor, with identifier slugs. */
export const LANGUAGE_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  Python: "python", TypeScript: "typescript", JavaScript: "javascript", Go: "go", Rust: "rust", Java: "java",
  Ruby: "ruby", "C#": "csharp", Kotlin: "kotlin", Swift: "swift", PHP: "php", "C++": "cpp",
});

export const BASE_SOURCE_KEYS = [
  "discoverySource", "repository", "repositoryUrl", "authorName", "authorLogin",
  "authorBasis", "authorSourceUrl", "path", "blob", "rawContentHash", "excerptHash",
  "licenseName", "licenseSpdx", "licenseFileUrl", "commit", "commitUrl", "blobUrl",
  "profileVersion", "crawlSnapshotId",
] as const;
export const LINEAGE_SOURCE_KEYS = [
  "queryId", "childCommit", "childTree", "parentCommit", "parentTree",
  "parentPath", "childPath", "parentMode", "childMode", "parentBlob", "childBlob",
  "parentRawContentHash", "childRawContentHash", "changedLineHash",
] as const;
export const PROJECT_SOURCE_KEYS = [...BASE_SOURCE_KEYS, ...LINEAGE_SOURCE_KEYS] as const;
export const AI_SOURCE_KEYS = [
  ...PROJECT_SOURCE_KEYS, "aiCreditRecorded", "aiAssistant", "changedFileCount", "commitAdditions", "commitDeletions",
] as const;
export const LANGUAGE_SOURCE_KEYS = [
  ...BASE_SOURCE_KEYS, "stackRelease", "stackRevision", "configuration", "stableRowId",
  "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId",
  "stackRepository", "stackPath", "detectedLicenses", "detectedLanguage", "generated",
  "vendor", "sourceEncoding", "byteLength", "visitDate", "revisionDate", "committerDate",
] as const;
/** Identities that may not repeat within a deck. */
export const DECK_DEDUPLICATION_KEYS = ["repository", "commit", "path", "blob", "rawContentHash", "excerptHash"] as const;
/** Identities that may not repeat across decks; a repository may. */
export const CROSS_DECK_KEYS = ["commit", "blob", "rawContentHash", "excerptHash"] as const;
/** Source values no pre-answer text may contain as a whole token. */
export const PROTECTED_SOURCE_KEYS = [
  "repository", "repositoryUrl", "authorName", "authorLogin", "authorSourceUrl", "path",
  "blob", "rawContentHash", "licenseName", "licenseSpdx", "licenseFileUrl", "commit",
  "commitUrl", "blobUrl",
] as const;

export interface ParsedSource extends JsonRecord {
  readonly discoverySource: "GITHUB_COMMIT_SEARCH" | "STACK_V2";
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
  readonly aiCreditRecorded?: boolean;
  readonly configuration?: StackLanguage;
}

/** One round as the artifact stores it: public text, the answer, the reveal, and its provenance. */
export interface FixtureRecord<Source = Readonly<JsonRecord>> {
  readonly kind: FixtureKind;
  readonly roundId: string;
  readonly roundVersion: string;
  readonly excerpt: string;
  readonly prompt: string;
  readonly candidates: readonly Readonly<{ id: string; label: string }>[];
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

export interface DeckRecord<Fixture = ExperimentFixture> {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly notice: string | null;
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
