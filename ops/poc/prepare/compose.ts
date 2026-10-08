import { createHash } from "node:crypto";

import {
  canonicalArtifactBytes,
  canonicalArtifactHash,
  canonicalBytes,
  canonicalHash,
} from "./canonical";
import type { GeneratedLanguageRounds } from "./language-rounds";
import {
  parseExperimentArtifact,
  parseRoundRecordSet,
  type ExperimentArtifact,
  type ExperimentFixture,
  type PrivateRevealRecord,
  type PublicRoundRecord,
  type RoundRecordSet,
} from "./model";
import type { CrawlProfile } from "./profile";
import type { GeneratedProvenanceRounds } from "./provenance-rounds";

const PROVENANCE_COUNT = 3;
const LANGUAGE_COUNT = 2;
const SHA256 = /^[0-9a-f]{64}$/u;

export class ComposeError extends Error {
  public constructor() {
    super("EXPERIMENT_COMPOSITION_REJECTED");
    this.name = "ComposeError";
  }
}

export interface ComposeOptions {
  readonly profile: CrawlProfile;
  readonly canonicalProfileBytes: Uint8Array;
  readonly acceptedResponseHashes: readonly string[];
  readonly provenance: GeneratedProvenanceRounds;
  readonly language: GeneratedLanguageRounds;
}

export interface ComposedExperiment {
  readonly artifact: ExperimentArtifact;
  readonly artifactBytes: Uint8Array;
  readonly artifactHash: string;
  readonly roundRecordSet: RoundRecordSet;
}

type GeneratedRounds = GeneratedProvenanceRounds | GeneratedLanguageRounds;

const fail = (): never => { throw new ComposeError(); };
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

const parseResponseHashes = (values: readonly string[]): readonly string[] => {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !SHA256.test(value))) fail();
  if (new Set(values).size !== values.length) fail();
  return Object.freeze([...values]);
};

const requireGroup = (
  generated: GeneratedRounds,
  count: number,
  kind: ExperimentFixture["kind"],
): void => {
  if (generated.fixtures.length !== count || generated.publicRounds.length !== count
    || Object.keys(generated.privateReveals).length !== count) fail();
  generated.fixtures.forEach((fixture, index) => {
    if (fixture.kind !== kind) fail();
    requireProjection(fixture, generated.publicRounds[index], generated.privateReveals[fixture.roundId]);
  });
};

const requireProjection = (
  fixture: ExperimentFixture,
  publicRound: PublicRoundRecord | undefined,
  privateReveal: PrivateRevealRecord | undefined,
): void => {
  if (publicRound === undefined) return fail();
  if (privateReveal === undefined) return fail();
  const expectedCandidates = fixture.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const expectedClues = fixture.clues.map((label, index) => ({ order: index + 1, label }));
  if (fixture.source.excerptHash !== rawHash(fixture.excerpt)
    || publicRound.roundId !== fixture.roundId || publicRound.roundVersionId !== fixture.roundVersion
    || publicRound.excerpt.versionId !== fixture.source.excerptHash
    || publicRound.excerpt.text !== fixture.excerpt || publicRound.mode.prompt !== fixture.prompt
    || publicRound.mode.kind !== (fixture.kind === "PROVENANCE" ? "provenance" : "language")
    || !exactCanonical(publicRound.mode.candidates, expectedCandidates)
    || !exactCanonical(publicRound.mode.clues, expectedClues)) fail();
  const expectedPrivate = {
    roundId: fixture.roundId, roundVersionId: fixture.roundVersion,
    correctCandidateId: fixture.correctCandidateId, evidence: fixture.evidence,
    explanation: fixture.explanation, attribution: fixture.attribution,
    helpfulSignals: fixture.helpfulSignals, misleadingSignals: fixture.misleadingSignals,
  };
  const actualPrivate = Object.fromEntries(Object.entries(privateReveal)
    .filter(([key]) => key !== "versions"));
  if (!exactCanonical(actualPrivate, expectedPrivate)) fail();
};

const requireBindings = (
  fixtures: readonly ExperimentFixture[],
  profile: CrawlProfile,
  snapshotId: string,
): void => {
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (fixture.source.profileVersion !== profile.profileVersion
      || fixture.source.crawlSnapshotId !== snapshotId || ids.has(fixture.roundId)) fail();
    ids.add(fixture.roundId);
  }
  for (const key of profile.deduplication) {
    const values = fixtures.map(({ source }) => source[key]);
    if (values.some((value) => typeof value !== "string" || value.length === 0)
      || new Set(values).size !== fixtures.length) fail();
  }
};

const requirePublicContainment = (
  fixtures: readonly ExperimentFixture[],
  publicRounds: readonly PublicRoundRecord[],
): void => {
  const publicText = new TextDecoder().decode(canonicalBytes(publicRounds));
  const protectedKeys = [
    "repository", "repositoryUrl", "authorName", "authorLogin", "authorSourceUrl", "path",
    "blob", "rawContentHash", "licenseName", "licenseSpdx", "licenseFileUrl", "commit",
    "commitUrl", "blobUrl",
  ] as const;
  for (const fixture of fixtures) {
    const protectedValues = [fixture.evidence, fixture.explanation, fixture.attribution,
      ...protectedKeys.map((key) => fixture.source[key])];
    if (protectedValues.some((value) => typeof value === "string" && containsProtected(publicText, value))) fail();
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

export const composeExperimentArtifact = (options: ComposeOptions): ComposedExperiment => {
  if (!(options.canonicalProfileBytes instanceof Uint8Array)
    || !sameBytes(options.canonicalProfileBytes, canonicalBytes(options.profile))) fail();
  const acceptedResponseHashes = parseResponseHashes(options.acceptedResponseHashes);
  const profileHash = canonicalHash(options.profile);
  const snapshot = crawlSnapshot(options.profile, profileHash, acceptedResponseHashes);
  requireGroup(options.provenance, PROVENANCE_COUNT, "PROVENANCE");
  requireGroup(options.language, LANGUAGE_COUNT, "LANGUAGE");
  const fixtures = [...options.provenance.fixtures, ...options.language.fixtures];
  requireBindings(fixtures, options.profile, snapshot.id);
  const artifact = parseExperimentArtifact({
    schemaVersion: "local-experiment-artifact.v1",
    contentClass: "LOCAL_UNREVIEWED_EXPERIMENT",
    profileHash,
    crawlSnapshot: snapshot,
    fixtures,
  });
  const publicRounds = [...options.provenance.publicRounds, ...options.language.publicRounds];
  requirePublicContainment(fixtures, publicRounds);
  const roundRecordSet = parseRoundRecordSet({
    sessionContractVersionId: canonicalHash({
      schemaVersion: artifact.schemaVersion, profileHash, crawlSnapshotId: snapshot.id,
    }),
    publicRounds,
    privateReveals: {
      ...options.provenance.privateReveals,
      ...options.language.privateReveals,
    },
  });
  return Object.freeze({
    artifact,
    artifactBytes: canonicalArtifactBytes(artifact),
    artifactHash: canonicalArtifactHash(artifact),
    roundRecordSet,
  });
};
