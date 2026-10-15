import {
  NAME_FUNCTION_ORDERS, NAME_FUNCTION_SOURCE_KEYS, NAME_SHAPE_HINTS, codeSpells, nameFunctionCandidateId, nameFunctionPairHint, nameShape,
} from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import type { ExperimentFixture } from "./model";
import { deepFreeze } from "./model-validation";
import type { CrawlProfile, StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, type GeneratedRounds } from "./round-helpers";

export class NameFunctionRoundsError extends Error {
  public constructor(code = "NAME_FUNCTION_ROUNDS_REJECTED") {
    super(code);
    this.name = "NameFunctionRoundsError";
  }
}

/** A curated file with one function chosen for a round, its masked pane, and its decoys, bound to the run's snapshot. */
export interface NameFunctionCandidate {
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
  readonly language: StackLanguage;
  readonly functionLine: number;
  /** The pane: the function, its name masked as `mystery`. */
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly answer: string;
  readonly decoys: readonly string[];
  readonly ranks: readonly number[];
  readonly extremes: readonly number[];
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new NameFunctionRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: NameFunctionCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_GITHUB", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "PATH_HISTORY",
    authorSourceUrl: `${root}/commit/${candidate.authorCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, authorCommit: candidate.authorCommit,
    language: candidate.language, functionName: candidate.answer, functionLine: candidate.functionLine,
  };
  if (Object.keys(source).sort().join("|") !== [...NAME_FUNCTION_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

/**
 * The decoy each round's second hint pairs with its answer: steered so picking the longer name of the pair (a coin
 * when both are as long) scores half the pool, no better than a coin once the hint has narrowed it to two.
 */
const pairedDecoys = (candidates: readonly NameFunctionCandidate[], roundIds: readonly string[]): readonly string[] => {
  const won = (answer: string, decoy: string) => answer.length > decoy.length ? 1 : answer.length === decoy.length ? 0.5 : 0;
  const outcomes = candidates.map(({ answer, decoys }) => new Set(decoys.map((decoy) => won(answer, decoy))).size);
  // Rounds with the fewest outcomes go first, so the rounds left can still even out what they forced.
  const sequence = candidates.map((_, index) => index).sort((left, right) => outcomes[left]! - outcomes[right]! || left - right);
  const picks: string[] = [];
  let score = 0;
  sequence.forEach((index, position) => {
    const { answer, decoys } = candidates[index]!;
    const target = (position + 1) / 2;
    // A stable sort, so among equally good decoys the round's own shuffled order decides.
    const pick = [...shuffled(roundIds[index]!, decoys, String)]
      .sort((left, right) => Math.abs(score + won(answer, left) - target) - Math.abs(score + won(answer, right) - target))[0]!;
    score += won(answer, pick);
    picks[index] = pick;
  });
  return picks;
};

const PARAMETERS = /\(([^)]*)\)/u;

const fixtureFor = (candidate: NameFunctionCandidate, paired: string, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!["name-function"]!.templates;
  const options = [candidate.answer, ...candidate.decoys];
  if (candidate.decoys.length !== 3 || new Set(options).size !== 4 || sha256(candidate.excerpt) !== candidate.excerptHash
    || options.some((option) => codeSpells(candidate.excerpt, option)) || !candidate.decoys.includes(paired)) fail();
  const shape = nameShape(candidate.answer);
  if (!candidate.decoys.some((decoy) => nameShape(decoy) === shape)) fail("NAME_FUNCTION_HINT_DECIDES");
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("name-function", source);
  // Options in text order; the game shuffles four-option rounds at every deal.
  const candidates = Object.freeze(NAME_FUNCTION_ORDERS[0]!(options)
    .map((label) => Object.freeze({ id: nameFunctionCandidateId(label), label, detail: null })));
  const clues = Object.freeze([NAME_SHAPE_HINTS[shape], nameFunctionPairHint(candidate.answer, paired)]);
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  const lines = candidate.excerpt.split("\n");
  const recursive = lines.slice(1).some((line) => /(?<![A-Za-z0-9_])mystery\s*\(/u.test(line));
  const parameters = PARAMETERS.exec(lines[0]!)?.[1]?.trim() ?? "";
  return Object.freeze({
    kind: "NAME_FUNCTION",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: nameFunctionCandidateId(candidate.answer),
    evidence: fill(template.evidence, { path: candidate.path, repository: candidate.repository, name: candidate.answer }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([recursive
      ? "It calls itself, so its name describes the whole job, not one step of it."
      : parameters.length > 0 ? "What it takes in and what it hands back narrow down which job it does." : "What its body changes says which job it does."]),
    misleadingSignals: Object.freeze(["The other three are real functions of the same file, so they fit its subject too."]),
    source,
  });
};

/**
 * One name-the-function round per candidate. The pool's answers take every rank about equally often in text order and
 * in length order (the selection balanced them), so no fixed pick or extreme is a better guess than any other.
 */
export const generateNameFunctionRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.["name-function"] ?? fail();
  const candidates = options.candidates as readonly NameFunctionCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  for (const key of ["path", "blob", "rawContentHash", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  for (const order of NAME_FUNCTION_ORDERS) {
    const ranks = [0, 0, 0, 0];
    for (const candidate of candidates) ranks[order([candidate.answer, ...candidate.decoys]).indexOf(candidate.answer)]! += 1;
    if (Math.max(...ranks) - Math.min(...ranks) > 2) fail("NAME_FUNCTION_RANK_UNBALANCED");
  }
  const roundIds = candidates.map((candidate) => roundIdFor("name-function", sourceFor(candidate, profile)));
  const paired = pairedDecoys(candidates, roundIds);
  return orderedPool(candidates.map((candidate, index) => fixtureFor(candidate, paired[index]!, profile)));
};
