import {
  AI_CANDIDATE_IDS,
  ARTIFACT_SCHEMA_VERSION,
  CONTENT_CLASS,
  CROSS_DECK_KEYS,
  DECK_DEDUPLICATION_KEYS,
  DECK_IDS,
  DECK_KINDS,
  LANGUAGE_SLUGS,
  PROFILE_VERSION,
  PROTECTED_SOURCE_KEYS,
  ROUNDS_PER_DECK,
  STACK_LANGUAGES,
  type DeckId,
  type ExperimentArtifact,
  type ExperimentFixture,
  type FixtureKind,
  type ParsedDeck,
  type ParsedFixture,
  type ParsedSource,
} from "./domain";
import { fail } from "./errors";
import {
  validateAiSource,
  validateLanguageSource,
  validateProjectSource,
  type StackIdentity,
} from "./source";
import {
  canonicalHash,
  codeText,
  containsProtected,
  deepFreeze,
  gitId,
  positiveInteger,
  rawHash,
  record,
  serializeCanonical,
  sha256,
  text,
  texts,
  type JsonRecord,
} from "./validation";

const FIXTURE_KEYS = [
  "kind", "roundId", "roundVersion", "excerpt", "prompt", "candidates", "clues",
  "correctCandidateId", "evidence", "explanation", "attribution", "helpfulSignals",
  "misleadingSignals", "source",
] as const;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CLAIM = /\b(?:human[- ]written|written by (?:a |an )?human|a human wrote|human-only|detector|detection|code style (?:shows|proves|indicates))\b/iu;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Case-insensitive whole-word owner, name, or `owner/name`. */
const mentionsRepository = (haystack: string, repository: string): boolean => {
  const [owner, name] = repository.split("/") as [string, string];
  return [repository, owner, name].some((value) =>
    new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}([^A-Za-z0-9_]|$)`, "iu").test(haystack));
};
/** Case-sensitive whole-word language label; `+` and `#` count as word characters for C++ and C#. */
const mentionsLabel = (haystack: string, label: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_+#])${escape(label)}([^A-Za-z0-9_+#]|$)`, "u").test(haystack);
const projectCandidateId = (repository: string): string =>
  `local-experiment.project.${rawHash(repository).slice(0, 16)}.v2`;
const languageCandidateId = (label: string): string =>
  `local-experiment.language.${LANGUAGE_SLUGS[label] ?? fail()}.v2`;

const parseCandidates = (value: unknown, expectedCount: number): readonly Readonly<{ id: string; label: string }>[] => {
  if (!Array.isArray(value) || value.length !== expectedCount) return fail();
  const candidates = value.map((entry) => {
    const candidate = record(entry, ["id", "label"]);
    return Object.freeze({ id: text(candidate.id), label: text(candidate.label) });
  });
  if (new Set(candidates.map(({ id }) => id)).size !== expectedCount
    || new Set(candidates.map(({ label }) => label)).size !== expectedCount) fail();
  return Object.freeze(candidates);
};

interface Snapshot {
  readonly id: string;
  readonly queryRoles: ReadonlyMap<string, string>;
  readonly stack: StackIdentity;
}

const parseSource = (
  kind: FixtureKind,
  value: unknown,
  snapshot: Snapshot,
): ParsedSource => kind === "LANGUAGE"
  ? validateLanguageSource(value, snapshot.id, snapshot.stack)
  : kind === "PROJECT"
    ? validateProjectSource(value, snapshot.id, snapshot.queryRoles)
    : validateAiSource(value, snapshot.id, snapshot.queryRoles);

type Semantics = Readonly<{
  kind: FixtureKind;
  excerpt: string;
  prompt: string;
  candidates: readonly Readonly<{ id: string; label: string }>[];
  clues: readonly string[];
  correctCandidateId: string;
  evidence: string;
  explanation: string;
  source: ParsedSource;
}>;

/** FR-032 and FR-009 as amended; clue 2 states the owner, so only the excerpt, prompt, and clue 1 are checked. */
const validateProject = ({ excerpt, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => !REPOSITORY.test(label) || id !== projectCandidateId(label))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (correct.label !== source.repository) fail();
  for (const part of [excerpt, prompt, clues[0]!]) {
    if (candidates.some(({ label }) => mentionsRepository(part, label))) fail();
  }
};

/** FR-025: the answer is the recorded language and no public text names a candidate. */
const validateLanguage = ({ excerpt, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => id !== languageCandidateId(label))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (correct.label !== source.configuration) fail();
  for (const part of [excerpt, prompt, ...clues]) {
    if (candidates.some(({ label }) => mentionsLabel(part, label))) fail();
  }
};

/** FR-012 and FR-024: the answer is the recorded credit, and no text claims authorship or detection. */
const validateAi = ({ prompt, candidates, clues, correctCandidateId, evidence, explanation, source }: Semantics): void => {
  if (candidates.map(({ id }) => id).join("|") !== AI_CANDIDATE_IDS.join("|")) fail();
  if (correctCandidateId !== (source.aiCreditRecorded ? AI_CANDIDATE_IDS[0] : AI_CANDIDATE_IDS[1])) fail();
  const claimText = [prompt, ...candidates.map(({ label }) => label), ...clues, evidence, explanation].join("\n");
  if (CLAIM.test(claimText)) fail();
};

const VALIDATORS: Readonly<Record<FixtureKind, (semantics: Semantics) => void>> = Object.freeze({
  PROJECT: validateProject, LANGUAGE: validateLanguage, AI_CREDIT: validateAi,
});

const parseAttribution = (value: unknown, source: ParsedSource): string => {
  const attribution = text(value);
  for (const required of [
    source.authorName, source.repository, source.licenseName, source.licenseSpdx, source.blobUrl,
  ]) {
    if (!attribution.includes(required)) fail();
  }
  return attribution;
};

const parseFixture = (value: unknown, kind: FixtureKind, snapshot: Snapshot): ParsedFixture => {
  const fixture = record(value, FIXTURE_KEYS);
  if (fixture.kind !== kind) fail();
  const excerpt = codeText(fixture.excerpt);
  const prompt = text(fixture.prompt);
  const candidates = parseCandidates(fixture.candidates, kind === "AI_CREDIT" ? 2 : 4);
  const clues = texts(fixture.clues, 2);
  const correctCandidateId = text(fixture.correctCandidateId);
  const evidence = text(fixture.evidence);
  const explanation = text(fixture.explanation);
  const source = parseSource(kind, fixture.source, snapshot);
  if (source.excerptHash !== rawHash(excerpt)) fail();
  VALIDATORS[kind]({ kind, excerpt, prompt, candidates, clues, correctCandidateId, evidence, explanation, source });
  return deepFreeze({
    kind,
    roundId: text(fixture.roundId),
    roundVersion: sha256(fixture.roundVersion),
    excerpt,
    prompt,
    candidates,
    clues,
    correctCandidateId,
    evidence,
    explanation,
    attribution: parseAttribution(fixture.attribution, source),
    helpfulSignals: texts(fixture.helpfulSignals),
    misleadingSignals: texts(fixture.misleadingSignals),
    source,
  });
};

const requireDistinct = (fixtures: readonly ParsedFixture[], keys: readonly string[]): void => {
  for (const key of keys) {
    const values = fixtures.map(({ source }) => source[key]);
    if (new Set(values).size !== fixtures.length) fail();
  }
};

const parseDeck = (value: unknown, snapshot: Snapshot): ParsedDeck => {
  const deck = record(value, ["id", "title", "description", "notice", "fixtures"]);
  const id = DECK_IDS.find((known) => known === deck.id) ?? fail();
  const title = text(deck.title);
  const description = text(deck.description);
  const notice = id === "ai" ? text(deck.notice) : deck.notice === null ? null : fail();
  const values = Array.isArray(deck.fixtures) ? deck.fixtures : fail();
  if (values.length !== ROUNDS_PER_DECK) fail();
  const fixtures = values.map((fixture: unknown) => parseFixture(fixture, DECK_KINDS[id], snapshot));
  requireDistinct(fixtures, DECK_DEDUPLICATION_KEYS);
  if (id === "language" && new Set(fixtures.map(({ source }) => source.configuration)).size !== ROUNDS_PER_DECK) fail();
  if (id === "ai") {
    const recorded = fixtures.filter(({ source }) => source.aiCreditRecorded === true).length;
    if (recorded < 2 || ROUNDS_PER_DECK - recorded < 2) fail();
  }
  if (notice !== null && CLAIM.test(notice)) fail();
  return deepFreeze({ id, title, description, notice, fixtures: Object.freeze(fixtures) });
};

/** FR-009 as amended: repository names may appear pre-answer only as project-round candidate labels. */
const requirePublicContainment = (fixtures: readonly ParsedFixture[]): void => {
  const publicText = serializeCanonical(fixtures.map((fixture) => ({
    excerpt: fixture.excerpt,
    prompt: fixture.prompt,
    candidates: fixture.kind === "PROJECT" ? fixture.candidates.map(({ id }) => ({ id })) : fixture.candidates,
    clues: fixture.clues,
  })));
  for (const fixture of fixtures) {
    const protectedValues = [
      fixture.evidence,
      fixture.explanation,
      fixture.attribution,
      ...PROTECTED_SOURCE_KEYS.map((key) => fixture.source[key])
        // A whole-file excerpt makes the raw-content hash equal the public excerpt hash.
        .filter((value) => value !== fixture.source.excerptHash),
    ];
    if (protectedValues.some((value) =>
      typeof value === "string" && containsProtected(publicText, value))) fail();
  }
};

const parseQueryRoles = (value: unknown): ReadonlyMap<string, string> => {
  const queries = Array.isArray(value) ? value : fail();
  if (queries.length === 0) fail();
  const roles = new Map<string, string>();
  for (const entry of queries) {
    const query = record(entry, ["id", "role", "query", "sort", "order", "pages", "resultCeiling"]);
    if (query.sort !== "committer-date" || query.order !== "desc"
      || (query.role !== "ai-credit" && query.role !== "ordinary")) fail();
    text(query.query);
    positiveInteger(query.pages);
    positiveInteger(query.resultCeiling);
    const id = text(query.id);
    if (roles.has(id)) fail();
    roles.set(id, query.role as string);
  }
  return roles;
};

const validateResponseHashes = (value: unknown, snapshotId: string, profileHash: string): void => {
  const acceptedResponseHashes = Array.isArray(value) ? value : fail();
  if (acceptedResponseHashes.length === 0) fail();
  const responseHashes = acceptedResponseHashes.map(sha256);
  if (new Set(responseHashes).size !== responseHashes.length
    || snapshotId !== canonicalHash({ profileHash, acceptedResponseHashes: responseHashes })) fail();
};

const parseSnapshot = (value: unknown, profileHash: string): Snapshot => {
  const snapshot = record(value, [
    "id", "profileVersion", "profileHash", "github", "stack", "acceptedResponseHashes",
  ]);
  const id = sha256(snapshot.id);
  if (snapshot.profileVersion !== PROFILE_VERSION || sha256(snapshot.profileHash) !== profileHash) fail();
  const github = record(snapshot.github, ["apiVersion", "queries"]);
  text(github.apiVersion);
  const queryRoles = parseQueryRoles(github.queries);
  const stack = record(snapshot.stack, ["release", "revision", "configurations"]);
  const identity = Object.freeze({ release: text(stack.release), revision: gitId(stack.revision) });
  if (!Array.isArray(stack.configurations)
    || stack.configurations.join("|") !== STACK_LANGUAGES.join("|")) fail();
  validateResponseHashes(snapshot.acceptedResponseHashes, id, profileHash);
  return Object.freeze({ id, queryRoles, stack: identity });
};

export const ARTIFACT_KEYS = ["schemaVersion", "contentClass", "profileHash", "crawlSnapshot", "decks"] as const;

/**
 * Parses the artifact into its decks. A run publishes every deck it could fill, so an artifact holds one
 * to three decks of five rounds, in deck order, each validated in full and against the others.
 */
export const parseArtifactDecks = (value: unknown): readonly ParsedDeck[] => {
  const artifact: JsonRecord = record(value, ARTIFACT_KEYS);
  if (artifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION || artifact.contentClass !== CONTENT_CLASS) fail();
  const profileHash = sha256(artifact.profileHash);
  const snapshot = parseSnapshot(artifact.crawlSnapshot, profileHash);
  const values = Array.isArray(artifact.decks) ? artifact.decks : fail();
  if (values.length === 0 || values.length > DECK_IDS.length) fail();
  const decks = values.map((deck: unknown) => parseDeck(deck, snapshot));
  const order = decks.map(({ id }) => DECK_IDS.indexOf(id));
  if (order.some((position, index) => index > 0 && position <= order[index - 1]!)) fail();
  const fixtures = decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures);
  const roundIds = fixtures.map(({ roundId }) => roundId.toLocaleLowerCase("en-US"));
  if (new Set(roundIds).size !== fixtures.length) fail();
  requireDistinct(fixtures, CROSS_DECK_KEYS);
  requirePublicContainment(fixtures);
  return Object.freeze(decks);
};

/** Validates the artifact in full and returns a frozen copy of it. */
export const parseExperimentArtifact = (value: unknown): ExperimentArtifact => {
  parseArtifactDecks(value);
  return deepFreeze(structuredClone(value)) as ExperimentArtifact;
};

/** Every fixture in deck order. */
export const artifactFixtures = (artifact: ExperimentArtifact): readonly ExperimentFixture[] =>
  artifact.decks.flatMap(({ fixtures }) => fixtures);

/** The SHA-256 of the artifact's canonical serialization, which the game pins. */
export const artifactHash = (value: unknown): string => canonicalHash(value);
