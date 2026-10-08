import { createHash } from "node:crypto";

import { canonicalHash } from "./canonical";
import type { GitHubAdmissionCandidate } from "./github-admission";
import {
  parsePrivateReveal,
  parsePublicRound,
  type ExperimentFixture,
  type PrivateRevealRecord,
  type PublicRoundRecord,
} from "./model";
import type { CrawlProfile } from "./profile";

type SourceRecord = Readonly<Record<string, unknown>>;
type ClassifiedCandidate = Readonly<{
  candidate: GitHubAdmissionCandidate;
  markerMatched: boolean;
  index: number;
}>;

export class ProvenanceRoundsError extends Error {
  public constructor() {
    super("PROVENANCE_ROUNDS_REJECTED");
    this.name = "ProvenanceRoundsError";
  }
}

export interface ProvenanceRoundsOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly GitHubAdmissionCandidate[];
}

export interface GeneratedProvenanceRounds {
  readonly fixtures: readonly ExperimentFixture[];
  readonly publicRounds: readonly PublicRoundRecord[];
  readonly privateReveals: Readonly<Record<string, PrivateRevealRecord>>;
}

const fail = (): never => { throw new ProvenanceRoundsError(); };
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const text = (value: unknown): string =>
  typeof value === "string" && value.trim() === value && value.length > 0 ? value : fail();
const codeText = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fail();

const TRAILER_ADDRESS = /^<[^\s<>]+>$/u;

/**
 * A configured marker is recorded when one full line of the commit message equals it,
 * or when a trailer line consists of the marker followed by exactly one space and one
 * angle-bracket address (the Git trailer form, e.g. `Co-authored-by: Copilot <id@host>`).
 * Nothing else matches: no substrings, prefixes, case folding, or surrounding text.
 */
export const markerRecorded = (message: string, markers: readonly string[]): boolean => {
  if (markers.some((marker) => marker.includes("\n") || marker.includes("\r"))) fail();
  const lines = message.split(/\r?\n/u);
  return lines.some((line) => markers.some((marker) => line === marker
    || (line.startsWith(`${marker} `) && TRAILER_ADDRESS.test(line.slice(marker.length + 1)))));
};

const sourceIdentity = (candidate: GitHubAdmissionCandidate, profile: CrawlProfile): string =>
  profile.deduplication.map((key) => text(candidate.source[key])).join("\0");

const validateCandidate = (
  candidate: GitHubAdmissionCandidate,
  profile: CrawlProfile,
  index: number,
): ClassifiedCandidate => {
  if (candidate.admissionDecision !== "AUTOMATED_POC_ADMISSION_ONLY") fail();
  const { lineage, source } = candidate;
  if (source.profileVersion !== profile.profileVersion
    || source.repository !== lineage.repository || source.commit !== lineage.commit
    || source.path !== lineage.path || source.blob !== lineage.blob
    || source.childCommit !== lineage.childCommit || source.childTree !== lineage.childTree
    || source.parentCommit !== lineage.parentCommit || source.parentTree !== lineage.parentTree
    || source.parentPath !== lineage.parentPath || source.childPath !== lineage.childPath
    || source.parentMode !== lineage.parentMode || source.childMode !== lineage.childMode
    || source.parentBlob !== lineage.parentBlob || source.childBlob !== lineage.childBlob
    || source.parentRawContentHash !== lineage.parentRawContentHash
    || source.childRawContentHash !== lineage.childRawContentHash
    || source.changedLineHash !== lineage.changedLineHash
    || source.excerptHash !== lineage.excerptHash) fail();
  const excerpt = codeText(lineage.excerpt);
  if (sha256(excerpt) !== source.excerptHash || !/^[0-9a-f]{64}$/u.test(text(source.changedLineHash))) fail();
  const message = text(lineage.commitMessage);
  return Object.freeze({ candidate, markerMatched: markerRecorded(message, profile.markers), index });
};

const selectCandidates = (options: ProvenanceRoundsOptions): readonly ClassifiedCandidate[] => {
  if (options.candidates.length < options.profile.selection.provenanceRounds) fail();
  const classified = options.candidates.map((candidate, index) =>
    validateCandidate(candidate, options.profile, index));
  const identities = classified.map(({ candidate }) => sourceIdentity(candidate, options.profile));
  if (new Set(identities).size !== identities.length) fail();
  const firstMatch = classified.findIndex(({ markerMatched }) => markerMatched);
  const firstMiss = classified.findIndex(({ markerMatched }) => !markerMatched);
  if (firstMatch < 0 || firstMiss < 0) fail();
  const selected = new Set([firstMatch, firstMiss]);
  for (const { index } of classified) {
    if (selected.size === options.profile.selection.provenanceRounds) break;
    selected.add(index);
  }
  return Object.freeze(classified.filter(({ index }) => selected.has(index)));
};

const roundCandidates = (profile: CrawlProfile) => Object.freeze([
  Object.freeze({
    id: "local-experiment.marker-recorded.v1",
    label: profile.templates.provenance.recordedCandidate,
  }),
  Object.freeze({
    id: "local-experiment.marker-not-recorded.v1",
    label: profile.templates.provenance.unrecordedCandidate,
  }),
]);

const attribution = (source: SourceRecord): string => [
  text(source.authorName),
  text(source.repository),
  `${text(source.licenseName)} (${text(source.licenseSpdx)})`,
  text(source.blobUrl),
].join(" · ");

const fixtureFor = (
  classified: ClassifiedCandidate,
  profile: CrawlProfile,
): ExperimentFixture => {
  const { candidate, markerMatched } = classified;
  const { lineage } = candidate;
  const template = profile.templates.provenance;
  if (template.clues.length !== 2) fail();
  const candidates = roundCandidates(profile);
  const source = Object.freeze({ ...candidate.source, markerMatched });
  const correctCandidateId = candidates[markerMatched ? 0 : 1]!.id;
  const evidence = markerMatched ? template.recordedEvidence : template.unrecordedEvidence;
  const roundId = `local-provenance-${canonicalHash({
    kind: "pinned-marker-record",
    repository: lineage.repository,
    commit: lineage.commit,
    path: lineage.path,
    blob: lineage.blob,
  }).slice(0, 24)}`;
  const roundVersion = canonicalHash({ source, excerpt: lineage.excerpt, template });
  return Object.freeze({
    kind: "PROVENANCE",
    roundId,
    roundVersion,
    excerpt: lineage.excerpt,
    prompt: template.prompt,
    candidates,
    clues: Object.freeze([...template.clues]),
    correctCandidateId,
    evidence,
    explanation: template.explanation,
    attribution: attribution(source),
    helpfulSignals: Object.freeze([evidence]),
    misleadingSignals: Object.freeze([template.clues[1]!]),
    source,
  });
};

const publicFor = (fixture: ExperimentFixture, profile: CrawlProfile): PublicRoundRecord => {
  const candidates = fixture.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const clues = fixture.clues.map((label, index) => ({ order: index + 1, label }));
  const candidateSet = canonicalHash(candidates);
  const clueSet = canonicalHash(clues);
  const scoring = canonicalHash({ scheme: "local-experiment-zero-one-two-clues.v1" });
  const rules = canonicalHash({ prompt: fixture.prompt, markers: profile.markers });
  return parsePublicRound({
    roundId: fixture.roundId,
    roundVersionId: fixture.roundVersion,
    excerpt: { versionId: fixture.source.excerptHash, text: fixture.excerpt },
    mode: {
      kind: "provenance",
      contractVersionId: canonicalHash({ candidates, prompt: fixture.prompt }),
      calibrationVersionId: canonicalHash({ profileVersion: profile.profileVersion }),
      prompt: fixture.prompt,
      candidates,
      clues,
    },
    versions: { candidateSet, clueSet, scoring, rules },
  });
};

const privateFor = (
  fixture: ExperimentFixture,
  publicRound: PublicRoundRecord,
): PrivateRevealRecord => parsePrivateReveal({
  roundId: fixture.roundId,
  roundVersionId: fixture.roundVersion,
  correctCandidateId: fixture.correctCandidateId,
  evidence: fixture.evidence,
  explanation: fixture.explanation,
  attribution: fixture.attribution,
  helpfulSignals: fixture.helpfulSignals,
  misleadingSignals: fixture.misleadingSignals,
  versions: {
    content: publicRound.excerpt.versionId,
    candidateSet: publicRound.versions.candidateSet,
    scoring: publicRound.versions.scoring,
    rules: publicRound.versions.rules,
    evidence: canonicalHash({ evidence: fixture.evidence }),
    reveal: canonicalHash({
      explanation: fixture.explanation,
      attribution: fixture.attribution,
      correctCandidateId: fixture.correctCandidateId,
    }),
  },
});

export const generateProvenanceRounds = (
  options: ProvenanceRoundsOptions,
): GeneratedProvenanceRounds => {
  const fixtures = Object.freeze(selectCandidates(options).map((candidate) =>
    fixtureFor(candidate, options.profile)));
  const publicRounds = Object.freeze(fixtures.map((fixture) => publicFor(fixture, options.profile)));
  const privateReveals = Object.freeze(Object.fromEntries(fixtures.map((fixture, index) => [
    fixture.roundId,
    privateFor(fixture, publicRounds[index]!),
  ])));
  return Object.freeze({ fixtures, publicRounds, privateReveals });
};
