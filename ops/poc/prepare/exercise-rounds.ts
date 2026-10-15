import {
  EXERCISE_SOURCE_KEYS, codeNamesExercise, copyNamesExercise, exerciseCandidateId,
} from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import type { ExperimentFixture } from "./model";
import { deepFreeze } from "./model-validation";
import type { CrawlProfile, ExerciseEntry, ExerciseFamily, StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, type GeneratedRounds } from "./round-helpers";

export class ExerciseRoundsError extends Error {
  public constructor(code = "EXERCISE_ROUNDS_REJECTED") {
    super(code);
    this.name = "ExerciseRoundsError";
  }
}

/** A track's reference solution chosen for an exercise round, with its masked window, bound to the run's snapshot. */
export interface ExerciseCandidate {
  readonly familyId: string;
  readonly exercise: string;
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
  readonly windowStart: number;
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new ExerciseRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: ExerciseCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_GITHUB", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "PATH_HISTORY",
    authorSourceUrl: `${root}/commit/${candidate.authorCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, authorCommit: candidate.authorCommit,
    exercise: candidate.exercise, language: candidate.language, windowStart: candidate.windowStart,
  };
  if (Object.keys(source).sort().join("|") !== [...EXERCISE_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

/** Whether code, or prose, names an exercise of the family (`codeNamesExercise`, `copyNamesExercise`). */
export const namesExercise = (value: string, exercises: readonly ExerciseEntry[], code: boolean): boolean =>
  exercises.some((exercise) => code ? codeNamesExercise(value, exercise) : copyNamesExercise(value, exercise));

const fixtureFor = (candidate: ExerciseCandidate, family: ExerciseFamily, entry: ExerciseEntry, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!.exercise!.templates;
  if (sha256(candidate.excerpt) !== candidate.excerptHash) fail();
  const clues = Object.freeze([entry.idea, entry.detail]);
  // No option may be named by the code, the prompt, or a hint, nor shown in the code by a symbol or a label stem: each
  // would answer the round, or rule an option out.
  if (namesExercise(candidate.excerpt, family.exercises, true)
    || [template.prompt, ...clues].some((part) => namesExercise(part, family.exercises, false))) fail("EXERCISE_NAME_SHOWN");
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("exercise", source);
  // Options in text order; the game shuffles four-option rounds at every deal.
  const candidates = Object.freeze([...family.exercises].sort((left, right) => left.label < right.label ? -1 : 1)
    .map(({ id, label }) => Object.freeze({ id: exerciseCandidateId(id), label, detail: null })));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  return Object.freeze({
    kind: "EXERCISE",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: exerciseCandidateId(entry.id),
    evidence: fill(template.evidence, { path: candidate.path, repository: candidate.repository, name: entry.label }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`${entry.label}: ${entry.idea}`]),
    misleadingSignals: Object.freeze([family.note]),
    source,
  });
};

/**
 * One exercise round per candidate. Each round offers its family's four exercises, and each family's rounds answer
 * each of its exercises equally often, each time from a different track, so no option set, place, or frequency
 * points to an answer.
 */
export const generateExerciseRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.exercise ?? fail();
  const candidates = options.candidates as readonly ExerciseCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  const fixtures = candidates.map((candidate) => {
    const family = deck.families.find(({ id }) => id === candidate.familyId) ?? fail();
    const entry = family.exercises.find(({ id }) => id === candidate.exercise) ?? fail();
    if (!candidate.path.startsWith(`exercises/practice/${entry.id}/`)) fail();
    return fixtureFor(candidate, family, entry, profile);
  });
  for (const familyId of new Set(candidates.map(({ familyId }) => familyId))) {
    const family = deck.families.find(({ id }) => id === familyId)!;
    for (const { id } of family.exercises) {
      const answered = candidates.filter(({ familyId: other, exercise }) => other === familyId && exercise === id);
      if (answered.length !== deck.roundsPerExercise || new Set(answered.map(({ repository }) => repository)).size !== answered.length) {
        fail("EXERCISE_FAMILY_UNBALANCED");
      }
    }
  }
  for (const key of ["path", "blob", "rawContentHash", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  return orderedPool(fixtures);
};
