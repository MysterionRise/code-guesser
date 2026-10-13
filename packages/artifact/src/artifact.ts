import {
  ARTIFACT_SCHEMA_VERSION,
  BEFORE_AFTER_CANDIDATE_IDS,
  CANDIDATE_COUNTS,
  CONTENT_CLASS,
  CROSS_DECK_KEYS,
  DECK_DEDUPLICATION_KEYS,
  DECK_IDS,
  DECK_KINDS,
  LANGUAGE_SLUGS,
  MAXIMUM_POOL_SIZE,
  PANE_LABELS,
  PROFILE_VERSION,
  PROTECTED_SOURCE_KEYS,
  ROUNDS_PER_SESSION,
  STACK_LANGUAGES,
  type CandidateRecord,
  type ExperimentArtifact,
  type ExperimentFixture,
  type FixtureKind,
  type Pane,
  type ParsedDeck,
  type ParsedFixture,
  type ParsedSource,
  type StackLanguage,
} from "./domain";
import { fail } from "./errors";
import { validateLineageSource, validateStackSource, type StackIdentity } from "./source";
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
  "kind", "roundId", "roundVersion", "panes", "prompt", "candidates", "clues",
  "correctCandidateId", "evidence", "explanation", "attribution", "helpfulSignals",
  "misleadingSignals", "source",
] as const;
const DECK_KEYS = ["id", "title", "description", "roundsPerSession", "fixtures"] as const;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CLAIM = /\b(?:human[- ]written|written by (?:a |an )?human|a human wrote|human-only|ai[- ]generated|detector|detection|code style (?:shows|proves|indicates))\b/iu;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Case-insensitive whole-word owner, name, or `owner/name`. */
export const mentionsRepository = (haystack: string, repository: string): boolean => {
  const [owner, name] = repository.split("/") as [string, string];
  return [repository, owner, name].some((value) =>
    new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}([^A-Za-z0-9_]|$)`, "iu").test(haystack));
};
/** Case-sensitive whole-word language label; `+` and `#` count as word characters for C++ and C#. */
export const mentionsLabel = (haystack: string, label: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_+#])${escape(label)}([^A-Za-z0-9_+#]|$)`, "u").test(haystack);
export const projectCandidateId = (repository: string): string =>
  `local-experiment.project.${rawHash(repository).slice(0, 16)}.v3`;
export const languageCandidateId = (label: string): string =>
  `local-experiment.language.${LANGUAGE_SLUGS[label as StackLanguage] ?? fail()}.v3`;

const parseCandidates = (value: unknown, kind: FixtureKind): readonly CandidateRecord[] => {
  const expected = CANDIDATE_COUNTS[kind];
  if (!Array.isArray(value) || value.length !== expected) return fail();
  const candidates = value.map((entry) => {
    const candidate = record(entry, ["id", "label", "detail"]);
    const detail = candidate.detail === null ? null : text(candidate.detail);
    if (detail !== null && kind !== "PROJECT") fail();
    return Object.freeze({ id: text(candidate.id), label: text(candidate.label), detail });
  });
  if (new Set(candidates.map(({ id }) => id)).size !== expected
    || new Set(candidates.map(({ label }) => label)).size !== expected) fail();
  return Object.freeze(candidates);
};

const parsePanes = (value: unknown, kind: FixtureKind): readonly Pane[] => {
  const expected = kind === "BEFORE_AFTER" ? PANE_LABELS : [null];
  if (!Array.isArray(value) || value.length !== expected.length) return fail();
  return Object.freeze(value.map((entry, index) => {
    const pane = record(entry, ["label", "text"]);
    if (pane.label !== expected[index]) fail();
    return Object.freeze({ label: expected[index]!, text: codeText(pane.text) });
  }));
};

interface Snapshot {
  readonly id: string;
  readonly queryIds: ReadonlySet<string>;
  readonly stack: StackIdentity;
}

type Semantics = Readonly<{
  panes: readonly Pane[];
  prompt: string;
  candidates: readonly CandidateRecord[];
  clues: readonly string[];
  correctCandidateId: string;
  source: ParsedSource;
}>;

/** The answer is the recorded repository, and no pre-answer text other than the labels names a candidate. */
const validateProject = ({ panes, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => !REPOSITORY.test(label) || id !== projectCandidateId(label))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (correct.label !== source.repository || panes[0]!.label !== null || source.excerptHash !== rawHash(panes[0]!.text)) fail();
  for (const part of [panes[0]!.text, prompt, ...clues]) {
    if (candidates.some(({ label }) => mentionsRepository(part, label))) fail();
  }
};

/** The answer is the recorded language; every option is a language the deck can hold, and no text names one. */
const validateLanguage = ({ panes, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => !(STACK_LANGUAGES as readonly string[]).includes(label) || id !== languageCandidateId(label))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (correct.label !== source.configuration || source.excerptHash !== rawHash(panes[0]!.text)) fail();
  for (const part of [panes[0]!.text, prompt, ...clues]) {
    if (candidates.some(({ label }) => mentionsLabel(part, label))) fail();
  }
};

/** The answer names the pane that holds the commit's version; the other pane holds its parent's. */
const validateBeforeAfter = ({ panes, candidates, correctCandidateId, source }: Semantics): void => {
  if (candidates.map(({ id }) => id).join("|") !== BEFORE_AFTER_CANDIDATE_IDS.join("|")) fail();
  const later = BEFORE_AFTER_CANDIDATE_IDS.indexOf(correctCandidateId as typeof BEFORE_AFTER_CANDIDATE_IDS[number]);
  if (later < 0) fail();
  const [laterPane, earlierPane] = later === 0 ? [panes[0]!, panes[1]!] : [panes[1]!, panes[0]!];
  if (rawHash(laterPane.text) !== source.excerptHash || rawHash(earlierPane.text) !== source.parentExcerptHash) fail();
};

const VALIDATORS: Readonly<Record<FixtureKind, (semantics: Semantics) => void>> = Object.freeze({
  PROJECT: validateProject, LANGUAGE: validateLanguage, BEFORE_AFTER: validateBeforeAfter,
});

const parseAttribution = (value: unknown, source: ParsedSource): string => {
  const attribution = text(value);
  for (const required of [source.authorName, source.repository, source.licenseName, source.licenseSpdx, source.blobUrl]) {
    if (!attribution.includes(required)) fail();
  }
  return attribution;
};

const parseFixture = (value: unknown, kind: FixtureKind, snapshot: Snapshot): ParsedFixture => {
  const fixture = record(value, FIXTURE_KEYS);
  if (fixture.kind !== kind) fail();
  const panes = parsePanes(fixture.panes, kind);
  const prompt = text(fixture.prompt);
  const candidates = parseCandidates(fixture.candidates, kind);
  const clues = texts(fixture.clues, 2);
  const correctCandidateId = text(fixture.correctCandidateId);
  const evidence = text(fixture.evidence);
  const explanation = text(fixture.explanation);
  const source = kind === "BEFORE_AFTER"
    ? validateLineageSource(fixture.source, snapshot.id, snapshot.queryIds)
    : validateStackSource(fixture.source, snapshot.id, snapshot.stack);
  VALIDATORS[kind]({ panes, prompt, candidates, clues, correctCandidateId, source });
  const helpfulSignals = texts(fixture.helpfulSignals);
  const misleadingSignals = texts(fixture.misleadingSignals);
  const claimText = [prompt, ...candidates.flatMap(({ label, detail }) => [label, detail ?? ""]), ...clues, evidence, explanation,
    ...helpfulSignals, ...misleadingSignals].join("\n");
  if (CLAIM.test(claimText)) fail();
  return deepFreeze({
    kind,
    roundId: text(fixture.roundId),
    roundVersion: sha256(fixture.roundVersion),
    panes,
    prompt,
    candidates,
    clues,
    correctCandidateId,
    evidence,
    explanation,
    attribution: parseAttribution(fixture.attribution, source),
    helpfulSignals,
    misleadingSignals,
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
  const deck = record(value, DECK_KEYS);
  const id = DECK_IDS.find((known) => known === deck.id) ?? fail();
  const title = text(deck.title);
  const description = text(deck.description);
  if (deck.roundsPerSession !== ROUNDS_PER_SESSION) fail();
  const values = Array.isArray(deck.fixtures) ? deck.fixtures : fail();
  if (values.length < ROUNDS_PER_SESSION || values.length > MAXIMUM_POOL_SIZE) fail();
  const fixtures = values.map((fixture: unknown) => parseFixture(fixture, DECK_KINDS[id], snapshot));
  requireDistinct(fixtures, DECK_DEDUPLICATION_KEYS);
  if (id === "before-after") {
    // Pane order carries no signal: the later version is pane A in half the pool, give or take one.
    const aLater = fixtures.filter(({ correctCandidateId }) => correctCandidateId === BEFORE_AFTER_CANDIDATE_IDS[0]).length;
    if (Math.abs(2 * aLater - fixtures.length) > 1) fail();
  }
  return deepFreeze({ id, title, description, roundsPerSession: ROUNDS_PER_SESSION, fixtures: Object.freeze(fixtures) });
};

/** Repository names may appear before the answer only as project-round candidate labels. */
const requirePublicContainment = (fixtures: readonly ParsedFixture[]): void => {
  const publicText = serializeCanonical(fixtures.map((fixture) => ({
    panes: fixture.panes,
    prompt: fixture.prompt,
    candidates: fixture.kind === "PROJECT" ? fixture.candidates.map(({ id, detail }) => ({ id, detail })) : fixture.candidates,
    clues: fixture.clues,
  })));
  for (const fixture of fixtures) {
    const protectedValues = [
      fixture.evidence,
      fixture.explanation,
      fixture.attribution,
      ...PROTECTED_SOURCE_KEYS.map((key) => fixture.source[key])
        // A whole-file excerpt makes the raw-content hash equal the public excerpt hash.
        .filter((value) => value !== fixture.source.excerptHash && value !== fixture.source.parentExcerptHash),
    ];
    if (protectedValues.some((value) => typeof value === "string" && containsProtected(publicText, value))) fail();
  }
};

const parseQueryIds = (value: unknown): ReadonlySet<string> => {
  const queries = Array.isArray(value) ? value : fail();
  const ids = new Set<string>();
  for (const entry of queries) {
    const query = record(entry, ["id", "query", "sort", "order", "pages", "resultCeiling"]);
    if (query.sort !== "committer-date" || query.order !== "desc") fail();
    text(query.query);
    positiveInteger(query.pages);
    positiveInteger(query.resultCeiling);
    const id = text(query.id);
    if (ids.has(id)) fail();
    ids.add(id);
  }
  return ids;
};

const validateResponseHashes = (value: unknown, snapshotId: string, profileHash: string): void => {
  const acceptedResponseHashes = Array.isArray(value) ? value : fail();
  if (acceptedResponseHashes.length === 0) fail();
  const responseHashes = acceptedResponseHashes.map(sha256);
  if (new Set(responseHashes).size !== responseHashes.length
    || snapshotId !== canonicalHash({ profileHash, acceptedResponseHashes: responseHashes })) fail();
};

const parseSnapshot = (value: unknown, profileHash: string): Snapshot => {
  const snapshot = record(value, ["id", "profileVersion", "profileHash", "github", "stack", "acceptedResponseHashes"]);
  const id = sha256(snapshot.id);
  if (snapshot.profileVersion !== PROFILE_VERSION || sha256(snapshot.profileHash) !== profileHash) fail();
  const github = record(snapshot.github, ["apiVersion", "queries"]);
  text(github.apiVersion);
  const queryIds = parseQueryIds(github.queries);
  const stack = record(snapshot.stack, ["release", "revision", "configurations"]);
  const identity = Object.freeze({ release: text(stack.release), revision: gitId(stack.revision) });
  if (!Array.isArray(stack.configurations)
    || stack.configurations.join("|") !== STACK_LANGUAGES.join("|")) fail();
  validateResponseHashes(snapshot.acceptedResponseHashes, id, profileHash);
  return Object.freeze({ id, queryIds, stack: identity });
};

export const ARTIFACT_KEYS = ["schemaVersion", "contentClass", "profileHash", "crawlSnapshot", "decks"] as const;

/**
 * Parses the artifact into its decks. A run publishes every deck it could fill, so an artifact holds one
 * to three decks in deck order, each a pool of rounds validated in full and against the others.
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
