import { canonicalHash } from "./canonical";
import type { ChangeKind } from "./fix-window";
import { deepFreeze } from "./model-validation";
import {
  FIX_CHANGE_HINTS, FIX_ORDERS, FIX_SOURCE_KEYS, SCORE_TOLERANCE, fixCandidateId, fixExtremeLimits, fixExtremeScores, fixLineLabel,
  fixPairHint, fixRanks, fixSlack, pairLongerScore, pairSlack, type ExperimentFixture,
} from "./model";
import { FIX_OPTIONS, type CrawlProfile, type FixDataset, type StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, type GeneratedRounds } from "./round-helpers";

export class FixRoundsError extends Error {
  public constructor(code = "FIX_ROUNDS_REJECTED") {
    super(code);
    this.name = "FixRoundsError";
  }
}

/** A confirmed one-line fix chosen for a round, with its window, bound to the run's snapshot. */
export interface FixCandidate {
  readonly dataset: FixDataset["id"];
  /** The dataset's own name for the bug, such as `Lang-26`. */
  readonly bugId: string;
  readonly repository: string;
  readonly language: StackLanguage;
  /** The fix's parent, whose file the round shows. */
  readonly commit: string;
  readonly fixCommit: string;
  readonly path: string;
  /** The file at `commit`. */
  readonly blob: string;
  readonly fixBlob: string;
  readonly rawContentHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
  readonly buggyLine: string;
  readonly fixedLine: string;
  readonly changedLine: number;
  readonly changeKind: ChangeKind;
  readonly windowStart: number;
  /** The changed line and three others, counted from the window's first line. */
  readonly answer: number;
  readonly decoys: readonly number[];
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly crawlSnapshotId: string;
}

/** How the reveal names each dataset. */
export const DATASET_NAMES: Readonly<Record<FixDataset["id"], string>> = Object.freeze({ defects4j: "Defects4J", bugsinpy: "BugsInPy" });

const fail = (code?: string): never => { throw new FixRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: FixCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_DATASET", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "FIX_COMMIT",
    authorSourceUrl: `${root}/commit/${candidate.fixCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, fixCommit: candidate.fixCommit,
    fixBlob: candidate.fixBlob, dataset: candidate.dataset, bugId: candidate.bugId, language: candidate.language,
    changedLine: candidate.changedLine, windowStart: candidate.windowStart,
  };
  if (Object.keys(source).sort().join("|") !== [...FIX_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

/** What a fix or vulnerable-line round shows, for balancing its deck: the pane, the changed line, and three others. */
export interface LineRound {
  readonly excerpt: string;
  /** The changed line and three others, counted from the window's first line. */
  readonly answer: number;
  readonly decoys: readonly number[];
}

/**
 * The decoy each round's second hint pairs with its answer, by index into the candidates. Each round's decoys are
 * taken in that round's own shuffled order, seeded by its round id; a round whose decoys are all shorter (or all
 * longer) than its answer keeps its first, and the rest are steered so the answer is the longer of its pair in about
 * half the pool, which leaves picking the longer line of the pair no better than a coin.
 */
export const pairedDecoys = (candidates: readonly LineRound[], roundIds: readonly string[]): readonly number[] => {
  const scored = candidates.map((candidate, index) => {
    const pane = candidate.excerpt.split("\n");
    return shuffled(roundIds[index]!, candidate.decoys, String)
      .map((line) => Object.freeze({ line, score: pairLongerScore(candidate.answer, line, pane) }));
  });
  const fixed = (decoys: typeof scored[number]): boolean => decoys.every(({ score }) => score === decoys[0]!.score);
  let longer = scored.reduce((sum, decoys) => sum + (fixed(decoys) ? decoys[0]!.score : 0), 0);
  return scored.map((decoys) => {
    if (fixed(decoys)) return decoys[0]!.line;
    const scores = decoys.map(({ score }) => score);
    const wanted = longer + 1 <= candidates.length / 2 ? Math.max(...scores) : Math.min(...scores);
    const pick = decoys.find(({ score }) => score === wanted)!;
    longer += pick.score;
    return pick.line;
  });
};

const fixtureFor = (candidate: FixCandidate, paired: number, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!.fix!.templates;
  const lines = candidate.excerpt.split("\n");
  const options = [candidate.answer, ...candidate.decoys].sort((left, right) => left - right);
  if (sha256(candidate.excerpt) !== candidate.excerptHash || candidate.decoys.length !== FIX_OPTIONS - 1
    || new Set(options).size !== FIX_OPTIONS || options.some((line) => !Number.isInteger(line) || line < 1 || line > lines.length)
    || candidate.changedLine - candidate.windowStart + 1 !== candidate.answer
    || lines[candidate.answer - 1]!.trim() !== candidate.buggyLine.trim() || !candidate.decoys.includes(paired)) fail();
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("fix", source);
  const clues = Object.freeze([FIX_CHANGE_HINTS[candidate.changeKind], fixPairHint(candidate.answer, paired)]);
  const candidates = Object.freeze(options.map((line) => Object.freeze({ id: fixCandidateId(line), label: fixLineLabel(line), detail: null })));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  return Object.freeze({
    kind: "FIX",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: fixCandidateId(candidate.answer),
    evidence: fill(template.evidence, {
      dataset: DATASET_NAMES[candidate.dataset], bug: candidate.bugId, repository: candidate.repository, line: String(candidate.answer),
    }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`Line ${candidate.answer} read “${candidate.buggyLine.trim()}”; the fix made it “${candidate.fixedLine.trim()}”.`]),
    misleadingSignals: Object.freeze(["Lines around a bug often look just as suspicious as the bug itself."]),
    source,
  });
};

/**
 * Whether a deck's line rounds are balanced: the answers take every rank equally often by position and by distance
 * from the pane's middle, and nearly so by length and by complexity; picking the line with the most or least of a
 * line feature does little better than chance; and the second hint's pair holds the longer line as the answer in
 * about half the pool.
 */
export const linesBalanced = (candidates: readonly LineRound[], paired: readonly number[]): boolean => {
  const counts = FIX_ORDERS.map(() => Array.from({ length: FIX_OPTIONS }, () => 0));
  const limits = fixExtremeLimits(candidates.length);
  const extremes = limits.map(() => 0);
  let longer = 0;
  candidates.forEach((candidate, index) => {
    const lines = [candidate.answer, ...candidate.decoys];
    const pane = candidate.excerpt.split("\n");
    fixRanks(candidate.answer, lines, pane).forEach((rank, order) => { counts[order]![rank]! += 1; });
    fixExtremeScores(candidate.answer, lines, pane).forEach((score, measure) => { extremes[measure]! += score; });
    longer += pairLongerScore(candidate.answer, paired[index]!, pane);
  });
  const slack = fixSlack(candidates.length);
  return !(counts.some((ranks, order) => Math.max(...ranks) > Math.ceil(candidates.length / FIX_OPTIONS) + slack[order]!)
    || extremes.some((score, measure) => score > limits[measure]! + SCORE_TOLERANCE)
    || Math.abs(longer - candidates.length / 2) > pairSlack(candidates.length));
};

/**
 * One fix round per candidate. Each round offers four lines of its window in line order, and the pool's answers
 * take every rank equally often by position and by distance from the pane's middle, and nearly so by length and by
 * complexity; picking the line with the most or least length, operators, indentation, or rare words, ties split,
 * does little better than chance; and the second hint's pair holds the longer line as the answer in about half the
 * pool. So no position, centrality, line feature, or longer half of a pair is a better guess than chance.
 */
export const generateFixRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.fix ?? fail();
  const candidates = options.candidates as readonly FixCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  const paired = pairedDecoys(candidates, candidates.map((candidate) => roundIdFor("fix", sourceFor(candidate, profile))));
  if (!linesBalanced(candidates, paired)) fail("FIX_RANK_UNBALANCED");
  for (const repository of new Set(candidates.map((candidate) => candidate.repository))) {
    if (candidates.filter((candidate) => candidate.repository === repository).length > deck.perRepository) fail("FIX_REPOSITORY_REPEATED");
  }
  for (const key of ["bugId", "commit", "fixCommit", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  return orderedPool(candidates.map((candidate, index) => fixtureFor(candidate, paired[index]!, profile)));
};
