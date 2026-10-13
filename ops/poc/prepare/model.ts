import {
  bool,
  codeText,
  count,
  deepFreeze,
  exact,
  fail,
  gitId,
  gitMode,
  positiveCount,
  record,
  sha256,
  text,
  texts,
  validUtcTimestamp,
  type RecordValue,
} from "./model-validation";
import { STACK_LANGUAGES } from "./profile";

export { ExperimentRecordError } from "./model-validation";
export {
  parsePrivateReveal,
  parsePublicRound,
  parseRoundRecordSet,
  type PrivateRevealRecord,
  type PublicRoundRecord,
  type RoundRecordSet,
} from "./model-rounds";
export { parseRunRecord, type RunRecord } from "./model-run";

export const DECK_IDS = Object.freeze(["project", "language", "ai"] as const);
export type DeckId = typeof DECK_IDS[number];
export type FixtureKind = "PROJECT" | "LANGUAGE" | "AI_CREDIT";
export const DECK_KINDS: Readonly<Record<DeckId, FixtureKind>> = Object.freeze({
  project: "PROJECT", language: "LANGUAGE", ai: "AI_CREDIT",
});
export const ROUNDS_PER_DECK = 5;
export const AI_CANDIDATE_IDS = Object.freeze([
  "local-experiment.ai-credit-recorded.v2",
  "local-experiment.ai-credit-absent.v2",
] as const);

export interface ExperimentFixture {
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
  readonly source: Readonly<RecordValue>;
}

export interface ExperimentDeck {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly notice: string | null;
  readonly fixtures: readonly ExperimentFixture[];
}

export interface ExperimentArtifact {
  readonly schemaVersion: "local-experiment-artifact.v2";
  readonly contentClass: "LOCAL_UNREVIEWED_EXPERIMENT";
  readonly profileHash: string;
  readonly crawlSnapshot: Readonly<RecordValue>;
  readonly decks: readonly ExperimentDeck[];
}

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
/** FR-026 as amended: identities that may not repeat across decks. Repository may. */
export const CROSS_DECK_KEYS = ["commit", "blob", "rawContentHash", "excerptHash"] as const;
const DEDUPLICATION_KEYS = ["repository", "commit", "path", "blob", "rawContentHash", "excerptHash"] as const;

const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const validateGitHubBindings = (source: RecordValue): void => {
  const repository = text(source.repository);
  const commit = gitId(source.commit);
  const path = text(source.path);
  const base = `https://github.com/${repository}`;
  if (source.repositoryUrl !== base) fail();
  const commitUrl = `${base}/commit/${commit}`;
  if (source.commitUrl !== commitUrl || source.authorSourceUrl !== commitUrl) fail();
  if (source.blobUrl !== `${base}/blob/${commit}/${encodedPath(path)}`) fail();
  const licensePrefix = `${base}/blob/${commit}/`;
  if (!text(source.licenseFileUrl).startsWith(licensePrefix)
    || text(source.licenseFileUrl).length === licensePrefix.length) fail();
};

const validateBaseSource = (source: RecordValue, snapshotId: string): void => {
  exact(source.authorBasis, "SELECTED_COMMIT");
  for (const key of [
    "repository", "repositoryUrl", "authorName", "path", "licenseName", "licenseSpdx",
    "licenseFileUrl", "commitUrl", "blobUrl", "profileVersion",
  ]) text(source[key]);
  if (source.authorLogin !== null) text(source.authorLogin);
  for (const key of ["blob", "commit"]) gitId(source[key]);
  for (const key of ["rawContentHash", "excerptHash"]) sha256(source[key]);
  if (sha256(source.crawlSnapshotId) !== snapshotId) fail();
  validateGitHubBindings(source);
};

const validateLineageSource = (source: RecordValue, queryRoles: ReadonlyMap<string, string>): string => {
  exact(source.discoverySource, "GITHUB_COMMIT_SEARCH");
  const role = queryRoles.get(text(source.queryId)) ?? fail();
  for (const key of [
    "childCommit", "childTree", "parentCommit", "parentTree", "parentBlob", "childBlob",
  ]) gitId(source[key]);
  for (const key of ["parentRawContentHash", "childRawContentHash", "changedLineHash"]) sha256(source[key]);
  for (const key of ["parentPath", "childPath"]) text(source[key]);
  gitMode(source.parentMode);
  gitMode(source.childMode);
  if (source.path !== source.parentPath || source.path !== source.childPath) fail();
  if (source.commit !== source.childCommit || source.blob !== source.childBlob) fail();
  if (source.rawContentHash !== source.childRawContentHash || source.parentBlob === source.childBlob) fail();
  return role;
};

const validateAiSource = (source: RecordValue, role: string): void => {
  const recorded = bool(source.aiCreditRecorded);
  if (recorded) text(source.aiAssistant);
  else if (source.aiAssistant !== null) fail();
  // FR-020 roles: credited commits come from ai-credit queries, uncredited ones from ordinary queries.
  if (recorded !== (role === "ai-credit")) fail();
  positiveCount(source.changedFileCount);
  count(source.commitAdditions);
  count(source.commitDeletions);
};

const validStackPath = (value: unknown): boolean => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value
    || value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

const validateLanguageSource = (source: RecordValue): void => {
  exact(source.discoverySource, "STACK_V2");
  exact(source.stackRelease, "v2.2.0");
  exact(source.stackRevision, "e565caa3a78c2423bd374333a472b049eb090e47");
  if (!(STACK_LANGUAGES as readonly unknown[]).includes(source.configuration)) fail();
  sha256(source.stableRowId);
  for (const key of [
    "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId",
  ]) gitId(source[key]);
  for (const key of ["stackRepository", "stackPath", "detectedLanguage"]) text(source[key]);
  exact(source.sourceEncoding, "UTF-8");
  for (const key of ["visitDate", "revisionDate", "committerDate"]) {
    if (!validUtcTimestamp(source[key])) fail();
  }
  const detectedLicenses = texts(source.detectedLicenses);
  bool(source.generated);
  bool(source.vendor);
  count(source.byteLength);
  if (source.detectedLanguage !== source.configuration) fail();
  if (!validStackPath(source.stackPath)
    || source.repository !== source.stackRepository || source.path !== source.stackPath) fail();
  // FR-030: the Stack identities are the revalidated GitHub blob and commit.
  if (source.swhContentId !== source.blob || source.swhRevisionId !== source.commit) fail();
  if (!detectedLicenses.includes(source.licenseSpdx as string)) fail();
  if (source.generated || source.vendor) fail();
};

const SOURCE_KEYS: Readonly<Record<FixtureKind, readonly string[]>> = Object.freeze({
  PROJECT: PROJECT_SOURCE_KEYS, LANGUAGE: LANGUAGE_SOURCE_KEYS, AI_CREDIT: AI_SOURCE_KEYS,
});

const validateSource = (
  value: unknown,
  kind: FixtureKind,
  snapshotId: string,
  queryRoles: ReadonlyMap<string, string>,
): void => {
  const source = record(value, SOURCE_KEYS[kind]);
  validateBaseSource(source, snapshotId);
  if (kind === "LANGUAGE") { validateLanguageSource(source); return; }
  const role = validateLineageSource(source, queryRoles);
  if (kind === "PROJECT" && role !== "ordinary") fail();
  if (kind === "AI_CREDIT") validateAiSource(source, role);
};

const FIXTURE_KEYS = [
  "kind", "roundId", "roundVersion", "excerpt", "prompt", "candidates", "clues",
  "correctCandidateId", "evidence", "explanation", "attribution", "helpfulSignals",
  "misleadingSignals", "source",
] as const;

const validateFixture = (
  value: unknown,
  expectedKind: FixtureKind,
  snapshotId: string,
  queryRoles: ReadonlyMap<string, string>,
): void => {
  const fixture = record(value, FIXTURE_KEYS);
  exact(fixture.kind, expectedKind);
  for (const key of [
    "roundId", "roundVersion", "prompt", "correctCandidateId", "evidence",
    "explanation", "attribution",
  ]) text(fixture[key]);
  codeText(fixture.excerpt);
  const candidates = Array.isArray(fixture.candidates) ? fixture.candidates : fail();
  const expectedCount = expectedKind === "AI_CREDIT" ? 2 : 4;
  if (candidates.length !== expectedCount) fail();
  const candidateIds = candidates.map((candidate: unknown) => {
    const parsed = record(candidate, ["id", "label"]);
    text(parsed.label);
    return text(parsed.id);
  });
  if (new Set(candidateIds).size !== candidateIds.length || !candidateIds.includes(fixture.correctCandidateId as string)) fail();
  const labels = candidates.map((candidate: RecordValue) => candidate.label as string);
  if (new Set(labels).size !== labels.length) fail();
  if (expectedKind === "AI_CREDIT" && candidateIds.join("|") !== AI_CANDIDATE_IDS.join("|")) fail();
  if (texts(fixture.clues).length !== 2) fail();
  texts(fixture.helpfulSignals);
  texts(fixture.misleadingSignals);
  validateSource(fixture.source, expectedKind, snapshotId, queryRoles);
};

const parseSnapshotQueries = (value: unknown): ReadonlyMap<string, string> => {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const roles = new Map<string, string>();
  for (const entry of value) {
    const query = record(entry, ["id", "role", "query", "sort", "order", "pages", "resultCeiling"]);
    const id = text(query.id);
    if (query.role !== "ai-credit" && query.role !== "ordinary") fail();
    text(query.query);
    exact(query.sort, "committer-date");
    exact(query.order, "desc");
    positiveCount(query.pages);
    positiveCount(query.resultCeiling);
    if (roles.has(id)) fail();
    roles.set(id, query.role as string);
  }
  return roles;
};

const parseCrawlSnapshot = (
  value: unknown,
  artifactProfileHash: string,
): Readonly<{ snapshotId: string; queryRoles: ReadonlyMap<string, string> }> => {
  const snapshot = record(value, [
    "id", "profileVersion", "profileHash", "github", "stack", "acceptedResponseHashes",
  ]);
  const snapshotId = sha256(snapshot.id);
  text(snapshot.profileVersion);
  if (sha256(snapshot.profileHash) !== artifactProfileHash) fail();
  const github = record(snapshot.github, ["apiVersion", "queries"]);
  text(github.apiVersion);
  const queryRoles = parseSnapshotQueries(github.queries);
  const stack = record(snapshot.stack, ["release", "revision", "configurations"]);
  exact(stack.release, "v2.2.0");
  exact(stack.revision, "e565caa3a78c2423bd374333a472b049eb090e47");
  if (!Array.isArray(stack.configurations)
    || stack.configurations.join("|") !== STACK_LANGUAGES.join("|")) fail();
  const responseHashes = Array.isArray(snapshot.acceptedResponseHashes)
    ? snapshot.acceptedResponseHashes.map(sha256)
    : fail();
  if (responseHashes.length === 0 || new Set(responseHashes).size !== responseHashes.length) fail();
  return Object.freeze({ snapshotId, queryRoles });
};

const requireDistinct = (fixtures: readonly RecordValue[], keys: readonly string[]): void => {
  for (const key of keys) {
    const values = fixtures.map((fixture) => text((fixture.source as RecordValue)[key]));
    if (new Set(values).size !== values.length) fail();
  }
};

const validateDeck = (
  value: unknown,
  id: DeckId,
  snapshotId: string,
  queryRoles: ReadonlyMap<string, string>,
): readonly RecordValue[] => {
  const deck = record(value, ["id", "title", "description", "notice", "fixtures"]);
  exact(deck.id, id);
  text(deck.title);
  text(deck.description);
  if (id === "ai") text(deck.notice);
  else if (deck.notice !== null) fail();
  const fixtures = Array.isArray(deck.fixtures) ? deck.fixtures as RecordValue[] : fail();
  if (fixtures.length !== ROUNDS_PER_DECK) fail();
  fixtures.forEach((fixture) => validateFixture(fixture, DECK_KINDS[id], snapshotId, queryRoles));
  requireDistinct(fixtures, DEDUPLICATION_KEYS);
  if (id === "language") {
    const languages = fixtures.map((fixture) => (fixture.source as RecordValue).configuration);
    if (new Set(languages).size !== ROUNDS_PER_DECK) fail();
  }
  if (id === "ai") {
    const recorded = fixtures.filter((fixture) => (fixture.source as RecordValue).aiCreditRecorded === true).length;
    if (recorded < 2 || ROUNDS_PER_DECK - recorded < 2) fail();
  }
  return fixtures;
};

export const parseExperimentArtifact = (value: unknown): ExperimentArtifact => {
  const artifact = record(value, [
    "schemaVersion", "contentClass", "profileHash", "crawlSnapshot", "decks",
  ]);
  exact(artifact.schemaVersion, "local-experiment-artifact.v2");
  exact(artifact.contentClass, "LOCAL_UNREVIEWED_EXPERIMENT");
  const profileHash = sha256(artifact.profileHash);
  const { snapshotId, queryRoles } = parseCrawlSnapshot(artifact.crawlSnapshot, profileHash);
  const decks = Array.isArray(artifact.decks) ? artifact.decks : fail();
  if (decks.length !== DECK_IDS.length) fail();
  const fixtures = decks.flatMap((deck: unknown, index: number) =>
    validateDeck(deck, DECK_IDS[index]!, snapshotId, queryRoles));
  const ids = fixtures.map(({ roundId }) => (roundId as string).toLocaleLowerCase("en-US"));
  if (new Set(ids).size !== ids.length) fail();
  requireDistinct(fixtures, CROSS_DECK_KEYS);
  return deepFreeze(structuredClone(artifact)) as unknown as ExperimentArtifact;
};

/** Every fixture in deck order. */
export const artifactFixtures = (artifact: ExperimentArtifact): readonly ExperimentFixture[] =>
  artifact.decks.flatMap(({ fixtures }) => fixtures);
