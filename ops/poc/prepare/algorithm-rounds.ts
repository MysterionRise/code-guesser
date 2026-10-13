import { canonicalHash } from "./canonical";
import { deepFreeze } from "./model-validation";
import { ALGORITHM_SOURCE_KEYS, algorithmCandidateId, namesAlgorithm, showsLabelStem, type ExperimentFixture } from "./model";
import type { AlgorithmEntry, AlgorithmFamily, CrawlProfile, StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, type GeneratedRounds } from "./round-helpers";

export class AlgorithmRoundsError extends Error {
  public constructor(code = "ALGORITHM_ROUNDS_REJECTED") {
    super(code);
    this.name = "AlgorithmRoundsError";
  }
}

/** A curated file chosen for an algorithm round, with its masked window, bound to the run's snapshot. */
export interface AlgorithmCandidate {
  readonly familyId: string;
  readonly algorithmId: string;
  readonly language: StackLanguage;
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly blob: string;
  readonly rawContentHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
  readonly authorCommit: string;
  readonly excerpt: string;
  readonly excerptHash: string;
  /** The real name the window masks, which the reveal gives. */
  readonly functionName: string;
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new AlgorithmRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: AlgorithmCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_GITHUB", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "PATH_HISTORY",
    authorSourceUrl: `${root}/commit/${candidate.authorCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, authorCommit: candidate.authorCommit,
    algorithmId: candidate.algorithmId, language: candidate.language, functionName: candidate.functionName,
  };
  if (Object.keys(source).sort().join("|") !== [...ALGORITHM_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

const fixtureFor = (candidate: AlgorithmCandidate, family: AlgorithmFamily, entry: AlgorithmEntry, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!.algorithm!.templates;
  if (sha256(candidate.excerpt) !== candidate.excerptHash || !/mystery/iu.test(candidate.excerpt)) fail();
  const clues = Object.freeze([entry.idea, entry.complexity]);
  // No option may be named by the code, the prompt, or a hint: each would answer the round by its wording. Nor may
  // the code show any option's label stem (`heapify`, a decoy's `buckets`), which would point to it or rule it out.
  for (const part of [candidate.excerpt, template.prompt, ...clues]) {
    if (family.algorithms.some((option) => namesAlgorithm(part, option))) fail("ALGORITHM_NAME_SHOWN");
  }
  if (family.algorithms.some(({ label }) => showsLabelStem(candidate.excerpt, label))) fail("ALGORITHM_NAME_SHOWN");
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("algorithm", source);
  const candidates = shuffled(roundId, family.algorithms, ({ id }) => id)
    .map(({ id, label }) => Object.freeze({ id: algorithmCandidateId(id), label, detail: null }));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  return Object.freeze({
    kind: "ALGORITHM",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates: Object.freeze(candidates),
    clues,
    correctCandidateId: algorithmCandidateId(entry.id),
    evidence: fill(template.evidence, { path: candidate.path, repository: candidate.repository, name: candidate.functionName }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`${entry.label}: ${entry.idea}`]),
    misleadingSignals: Object.freeze([family.note]),
    source,
  });
};

/**
 * One algorithm round per candidate. Each round offers its family's four algorithms, and each family's rounds
 * answer each of its algorithms exactly once, so no option set and no option's frequency points to an answer.
 */
export const generateAlgorithmRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.algorithm ?? fail();
  const candidates = options.candidates as readonly AlgorithmCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  const fixtures = candidates.map((candidate) => {
    const family = deck.families.find(({ id }) => id === candidate.familyId) ?? fail();
    const entry = family.algorithms.find(({ id }) => id === candidate.algorithmId) ?? fail();
    return fixtureFor(candidate, family, entry, profile);
  });
  for (const familyId of new Set(candidates.map(({ familyId }) => familyId))) {
    const answered = candidates.filter((candidate) => candidate.familyId === familyId).map(({ algorithmId }) => algorithmId).sort();
    const family = deck.families.find(({ id }) => id === familyId)!;
    if (answered.join("|") !== family.algorithms.map(({ id }) => id).sort().join("|")) fail("ALGORITHM_FAMILY_UNBALANCED");
  }
  for (const key of ["path", "blob", "rawContentHash", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  return orderedPool(fixtures);
};
