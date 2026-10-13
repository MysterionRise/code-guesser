import { createHash } from "node:crypto";

import {
  canonicalArtifactBytes,
  canonicalArtifactHash,
  canonicalBytes,
  canonicalHash,
} from "./canonical";
import {
  CROSS_DECK_KEYS,
  DECK_IDS,
  DECK_KINDS,
  ROUNDS_PER_DECK,
  parseExperimentArtifact,
  parseRoundRecordSet,
  type DeckId,
  type ExperimentArtifact,
  type ExperimentFixture,
  type PrivateRevealRecord,
  type PublicRoundRecord,
  type RoundRecordSet,
} from "./model";
import { mentionsLabel, type CrawlProfile } from "./profile";
import { mentionsRepository } from "./project-rounds";
import type { GeneratedRounds } from "./round-projection";

const SHA256 = /^[0-9a-f]{64}$/u;
const MODE_KINDS: Readonly<Record<ExperimentFixture["kind"], string>> = Object.freeze({
  PROJECT: "project", LANGUAGE: "language", AI_CREDIT: "ai",
});

export class ComposeError extends Error {
  /** A safe, data-free reason code such as PUBLIC_CONTAINMENT_LICENSESPDX_IN_EXCERPT, when one is known. */
  public readonly code: string | undefined;

  public constructor(code?: string) {
    super("EXPERIMENT_COMPOSITION_REJECTED");
    this.name = "ComposeError";
    this.code = code;
  }
}

export interface ComposeOptions {
  readonly profile: CrawlProfile;
  readonly canonicalProfileBytes: Uint8Array;
  readonly acceptedResponseHashes: readonly string[];
  readonly project: GeneratedRounds;
  readonly language: GeneratedRounds;
  readonly ai: GeneratedRounds;
}

export interface ComposedExperiment {
  readonly artifact: ExperimentArtifact;
  readonly artifactBytes: Uint8Array;
  readonly artifactHash: string;
  readonly roundRecordSet: RoundRecordSet;
}

const fail = (code?: string): never => { throw new ComposeError(code); };
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
const exactCanonical = (left: unknown, right: unknown): boolean =>
  canonicalHash(left) === canonicalHash(right);
const rawHash = (value: string): string => createHash("sha256").update(value).digest("hex");
/** True when the protected value appears in public text as a whole token (non-alphanumeric boundaries). */
export const containsProtected = (publicText: string, value: string): boolean => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "u").test(publicText);
};
export const PROTECTED_SOURCE_KEYS = [
  "repository", "repositoryUrl", "authorName", "authorLogin", "authorSourceUrl", "path",
  "blob", "rawContentHash", "licenseName", "licenseSpdx", "licenseFileUrl", "commit",
  "commitUrl", "blobUrl",
] as const;

const parseResponseHashes = (values: readonly string[]): readonly string[] => {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !SHA256.test(value))) fail();
  if (new Set(values).size !== values.length) fail();
  return Object.freeze([...values]);
};

const requireProjection = (
  fixture: ExperimentFixture,
  publicRound: PublicRoundRecord | undefined,
  privateReveal: PrivateRevealRecord | undefined,
): void => {
  if (publicRound === undefined || privateReveal === undefined) return fail();
  const expectedCandidates = fixture.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const expectedClues = fixture.clues.map((label, index) => ({ order: index + 1, label }));
  if (fixture.source.excerptHash !== rawHash(fixture.excerpt)
    || publicRound.roundId !== fixture.roundId || publicRound.roundVersionId !== fixture.roundVersion
    || publicRound.excerpt.versionId !== fixture.source.excerptHash
    || publicRound.excerpt.text !== fixture.excerpt || publicRound.mode.prompt !== fixture.prompt
    || publicRound.mode.kind !== MODE_KINDS[fixture.kind]
    || !exactCanonical(publicRound.mode.candidates, expectedCandidates)
    || !exactCanonical(publicRound.mode.clues, expectedClues)) fail();
  const expectedPrivate = {
    roundId: fixture.roundId, roundVersionId: fixture.roundVersion,
    correctCandidateId: fixture.correctCandidateId, evidence: fixture.evidence,
    explanation: fixture.explanation, attribution: fixture.attribution,
    helpfulSignals: fixture.helpfulSignals, misleadingSignals: fixture.misleadingSignals,
  };
  const actualPrivate = Object.fromEntries(Object.entries(privateReveal).filter(([key]) => key !== "versions"));
  if (!exactCanonical(actualPrivate, expectedPrivate)) fail();
};

const requireDeck = (generated: GeneratedRounds, id: DeckId): void => {
  if (generated.fixtures.length !== ROUNDS_PER_DECK || generated.publicRounds.length !== ROUNDS_PER_DECK
    || Object.keys(generated.privateReveals).length !== ROUNDS_PER_DECK) fail();
  generated.fixtures.forEach((fixture, index) => {
    if (fixture.kind !== DECK_KINDS[id]) fail();
    requireProjection(fixture, generated.publicRounds[index], generated.privateReveals[fixture.roundId]);
  });
};

const requireBindings = (
  decks: readonly (readonly ExperimentFixture[])[],
  profile: CrawlProfile,
  snapshotId: string,
): void => {
  const all = decks.flat();
  const ids = new Set<string>();
  for (const fixture of all) {
    if (fixture.source.profileVersion !== profile.profileVersion
      || fixture.source.crawlSnapshotId !== snapshotId || ids.has(fixture.roundId)) fail();
    ids.add(fixture.roundId);
  }
  const distinct = (fixtures: readonly ExperimentFixture[], keys: readonly string[]): void => {
    for (const key of keys) {
      const values = fixtures.map(({ source }) => source[key]);
      if (values.some((value) => typeof value !== "string" || value.length === 0)
        || new Set(values).size !== fixtures.length) fail();
    }
  };
  for (const fixtures of decks) distinct(fixtures, profile.deduplication);
  distinct(all, CROSS_DECK_KEYS);
};

/** FR-009 as amended: a repository name may appear pre-answer only as a project-round candidate label. */
const publicTextWithoutProjectLabels = (publicRounds: readonly PublicRoundRecord[]): string =>
  new TextDecoder().decode(canonicalBytes(publicRounds.map((round) => round.mode.kind !== "project" ? round : {
    ...round, mode: { ...round.mode, candidates: round.mode.candidates.map(({ candidateId }) => ({ candidateId })) },
  })));

const requireOwnCandidatesAbsent = (fixture: ExperimentFixture): void => {
  if (fixture.kind === "PROJECT") {
    // FR-032 authorizes clue 2 to state the owner; the excerpt, prompt, and clue 1 may not name any candidate.
    const publicParts = [["EXCERPT", fixture.excerpt], ["PROMPT", fixture.prompt], ["CLUE1", fixture.clues[0]!]] as const;
    for (const [part, value] of publicParts) {
      if (fixture.candidates.some(({ label }) => mentionsRepository(value, label))) fail(`PUBLIC_CONTAINMENT_CANDIDATE_IN_${part}`);
    }
  }
  if (fixture.kind === "LANGUAGE") {
    if (fixture.candidates.some(({ label }) => mentionsLabel(fixture.excerpt, label))) fail("PUBLIC_CONTAINMENT_CANDIDATE_IN_EXCERPT");
    if ([fixture.prompt, ...fixture.clues].some((value) => fixture.candidates.some(({ label }) => mentionsLabel(value, label)))) {
      fail("PUBLIC_CONTAINMENT_CANDIDATE_IN_CLUES");
    }
  }
};

const requirePublicContainment = (
  fixtures: readonly ExperimentFixture[],
  publicRounds: readonly PublicRoundRecord[],
): void => {
  const publicText = publicTextWithoutProjectLabels(publicRounds);
  for (const fixture of fixtures) {
    requireOwnCandidatesAbsent(fixture);
    const protectedEntries: readonly (readonly [string, unknown])[] = [
      ["evidence", fixture.evidence], ["explanation", fixture.explanation], ["attribution", fixture.attribution],
      ...PROTECTED_SOURCE_KEYS.map((key) => [key, fixture.source[key]] as const),
    ];
    for (const [name, value] of protectedEntries) {
      if (typeof value !== "string" || !containsProtected(publicText, value)) continue;
      // A whole-file excerpt makes rawContentHash equal the public excerpt hash: a hash of public text.
      if (name === "rawContentHash" && value === fixture.source.excerptHash) continue;
      // Name only the protected key and the public field that exposed it; never the value.
      const stripped = JSON.parse(publicText) as Record<string, unknown>[];
      const field = stripped.flatMap((round) => Object.entries(round))
        .find(([, part]) => containsProtected(JSON.stringify(part), value))?.[0] ?? "UNKNOWN";
      fail(`PUBLIC_CONTAINMENT_${name.toUpperCase()}_IN_${field.toUpperCase()}`);
    }
  }
};

const crawlSnapshot = (
  profile: CrawlProfile,
  profileHash: string,
  acceptedResponseHashes: readonly string[],
) => Object.freeze({
  id: canonicalHash({ profileHash, acceptedResponseHashes }),
  profileVersion: profile.profileVersion,
  profileHash,
  github: Object.freeze({
    apiVersion: profile.github.apiVersion,
    queries: Object.freeze(profile.github.queries.map((query) => Object.freeze({
      ...query, pages: profile.capacity.githubPages, resultCeiling: profile.capacity.githubResults,
    }))),
  }),
  stack: Object.freeze({
    release: profile.stack.release, revision: profile.stack.revision,
    configurations: Object.freeze(profile.stack.configurations.map(({ configuration }) => configuration)),
  }),
  acceptedResponseHashes,
});

const deckMetadata = (profile: CrawlProfile, id: DeckId) => {
  const template = profile.templates[id];
  return { id, title: template.title, description: template.description, notice: id === "ai" ? profile.templates.ai.notice : null };
};

export const composeExperimentArtifact = (options: ComposeOptions): ComposedExperiment => {
  if (!(options.canonicalProfileBytes instanceof Uint8Array)
    || !sameBytes(options.canonicalProfileBytes, canonicalBytes(options.profile))) fail();
  const acceptedResponseHashes = parseResponseHashes(options.acceptedResponseHashes);
  const profileHash = canonicalHash(options.profile);
  const snapshot = crawlSnapshot(options.profile, profileHash, acceptedResponseHashes);
  const generated: Readonly<Record<DeckId, GeneratedRounds>> = { project: options.project, language: options.language, ai: options.ai };
  for (const id of DECK_IDS) requireDeck(generated[id], id);
  requireBindings(DECK_IDS.map((id) => generated[id].fixtures), options.profile, snapshot.id);
  const artifact = parseExperimentArtifact({
    schemaVersion: "local-experiment-artifact.v2",
    contentClass: "LOCAL_UNREVIEWED_EXPERIMENT",
    profileHash,
    crawlSnapshot: snapshot,
    decks: DECK_IDS.map((id) => ({ ...deckMetadata(options.profile, id), fixtures: generated[id].fixtures })),
  });
  const fixtures = DECK_IDS.flatMap((id) => generated[id].fixtures);
  const publicRounds = DECK_IDS.flatMap((id) => generated[id].publicRounds);
  requirePublicContainment(fixtures, publicRounds);
  const roundRecordSet = parseRoundRecordSet({
    sessionContractVersionId: canonicalHash({ schemaVersion: artifact.schemaVersion, profileHash, crawlSnapshotId: snapshot.id }),
    publicRounds,
    privateReveals: Object.assign({}, ...DECK_IDS.map((id) => generated[id].privateReveals)),
  });
  return Object.freeze({
    artifact,
    artifactBytes: canonicalArtifactBytes(artifact),
    artifactHash: canonicalArtifactHash(artifact),
    roundRecordSet,
  });
};
