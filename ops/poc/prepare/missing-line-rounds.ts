import {
  GAP_MARKER, MISSING_LINE_KIND_HINTS, MISSING_LINE_ORDERS, MISSING_LINE_SOURCE_KEYS, lineKind, missingLineCandidateId, missingLinePairHint,
  profileAtLeast, type ProfileVersion,
} from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import type { ExperimentFixture } from "./model";
import { deepFreeze } from "./model-validation";
import type { CrawlProfile, StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, type GeneratedRounds } from "./round-helpers";

export class MissingLineRoundsError extends Error {
  public constructor(code = "MISSING_LINE_ROUNDS_REJECTED") {
    super(code);
    this.name = "MissingLineRoundsError";
  }
}

/** A curated file with one gap chosen for a round, its window, and its decoys, bound to the run's snapshot. */
export interface MissingLineCandidate {
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
  readonly windowStart: number;
  readonly gapLine: number;
  /** The pane: the window with the gap marker in place of the hidden line. */
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly answer: string;
  readonly decoys: readonly string[];
  readonly ranks: readonly number[];
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new MissingLineRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: MissingLineCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_GITHUB", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "PATH_HISTORY",
    authorSourceUrl: `${root}/commit/${candidate.authorCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, authorCommit: candidate.authorCommit,
    language: candidate.language, gapLine: candidate.gapLine, windowStart: candidate.windowStart,
  };
  if (Object.keys(source).sort().join("|") !== [...MISSING_LINE_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

const NAME = /[A-Za-z_][A-Za-z0-9_]*/gu;

/**
 * The decoy each round's second hint pairs with its answer: taken in the round's own shuffled order, and steered so
 * the answer is the longer of its pair in about half the pool, which leaves picking the longer line no better than
 * a coin once the hint has narrowed it to two. From v7 on (#200) the decoy does what the answer does, so the first
 * hint leaves both lines of the pair open.
 */
const pairedDecoys = (candidates: readonly MissingLineCandidate[], roundIds: readonly string[], version: ProfileVersion): readonly string[] => {
  let longer = 0;
  const strict = profileAtLeast(version, "local-real-rounds.v7");
  return candidates.map((candidate, index) => {
    const decoys = shuffled(roundIds[index]!, candidate.decoys, String)
      .filter((decoy) => !strict || lineKind(decoy) === lineKind(candidate.answer));
    if (decoys.length === 0) fail("MISSING_LINE_HINT_DECIDES");
    const wantLonger = longer * 2 < index + 1;
    const pick = decoys.find((decoy) => (candidate.answer.length > decoy.length) === wantLonger) ?? decoys[0]!;
    if (candidate.answer.length > pick.length) longer += 1;
    return pick;
  });
};

const fixtureFor = (candidate: MissingLineCandidate, paired: string, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!["missing-line"]!.templates;
  const options = [candidate.answer, ...candidate.decoys];
  const lines = candidate.excerpt.split("\n");
  const gap = candidate.gapLine - candidate.windowStart + 1;
  if (candidate.decoys.length !== 3 || new Set(options).size !== 4 || sha256(candidate.excerpt) !== candidate.excerptHash
    || lines[gap - 1]?.trim() !== GAP_MARKER || lines.filter((line) => line.trim() === GAP_MARKER).length !== 1
    || options.some((option) => lines.some((line) => line.trim() === option)) || !candidate.decoys.includes(paired)) fail();
  const kind = lineKind(candidate.answer);
  if (!candidate.decoys.some((decoy) => lineKind(decoy) === kind)) fail("MISSING_LINE_HINT_DECIDES");
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("missing-line", source);
  // Options in text order; the game shuffles four-option rounds at every deal.
  const candidates = Object.freeze(MISSING_LINE_ORDERS[0]!(options)
    .map((label) => Object.freeze({ id: missingLineCandidateId(label), label, detail: null })));
  const clues = Object.freeze([MISSING_LINE_KIND_HINTS[kind], missingLinePairHint(candidate.answer, paired)]);
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  const around = new Set(lines.flatMap((line) => line.trim() === GAP_MARKER ? [] : line.match(NAME) ?? []));
  const shared = [...new Set(candidate.answer.match(NAME) ?? [])].filter((name) => around.has(name) && name.length > 1).slice(0, 3);
  return Object.freeze({
    kind: "MISSING_LINE",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: missingLineCandidateId(candidate.answer),
    evidence: fill(template.evidence, { path: candidate.path, repository: candidate.repository, line: String(candidate.gapLine) }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([shared.length > 0
      ? `It works with ${shared.map((name) => `\`${name}\``).join(", ")}, which the code around the gap uses.`
      : "It is the step the line after the gap depends on."]),
    misleadingSignals: Object.freeze(["The other three are real lines of the same file at the same indentation, so their names can look familiar too."]),
    source,
  });
};

/**
 * One missing-line round per candidate. The pool's answers take every rank about equally often in text order and in
 * length order (the selection balanced them), so no fixed pick or extreme is a better guess than any other.
 */
export const generateMissingLineRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.["missing-line"] ?? fail();
  const candidates = options.candidates as readonly MissingLineCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  for (const key of ["path", "blob", "rawContentHash", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  for (const order of MISSING_LINE_ORDERS) {
    const ranks = [0, 0, 0, 0];
    for (const candidate of candidates) ranks[order([candidate.answer, ...candidate.decoys]).indexOf(candidate.answer)]! += 1;
    if (Math.max(...ranks) - Math.min(...ranks) > 2) fail("MISSING_LINE_RANK_UNBALANCED");
  }
  const roundIds = candidates.map((candidate) => roundIdFor("missing-line", sourceFor(candidate, profile)));
  const paired = pairedDecoys(candidates, roundIds, profile.profileVersion);
  return orderedPool(candidates.map((candidate, index) => fixtureFor(candidate, paired[index]!, profile)));
};
