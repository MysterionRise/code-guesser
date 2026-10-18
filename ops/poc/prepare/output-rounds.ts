import { canonicalHash } from "./canonical";
import type { DoctestExample } from "./doctest-parse";
import { deepFreeze } from "./model-validation";
import {
  OUTPUT_HINT, OUTPUT_ORDERS, OUTPUT_SOURCE_KEYS, SCORE_TOLERANCE, echoesArgument, numericOutputs, outputCandidateId, outputOrder, outputShape,
  profileAtLeast, transformGivesAway, transformLimit, transformScore, type ExperimentFixture, type ProfileVersion,
} from "./model";
import { OUTPUT_OPTIONS, type CrawlProfile } from "./profile";
import { attributionFor, balancedChoice, fill, orderedPool, roundIdFor, sha256, shuffled, type GeneratedRounds } from "./round-helpers";

export class OutputRoundsError extends Error {
  public constructor(code = "OUTPUT_ROUNDS_REJECTED") {
    super(code);
    this.name = "OutputRoundsError";
  }
}

/** A curated function chosen for an output round, with the call it asks about, bound to the run's snapshot. */
export interface OutputCandidate {
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
  readonly functionName: string;
  /** The function as the pane shows it, without docstring or comments. */
  readonly code: string;
  /** The doctest the round asks about. */
  readonly answer: DoctestExample;
  /** Three more of the function's doctests, each with a different output of the same shape. */
  readonly decoys: readonly DoctestExample[];
  /** The pane: `code`, a blank line, and the answer's call. */
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new OutputRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

/** The pane: the function, a blank line, and the one call the round asks about. */
export const outputPane = (code: string, call: string): string => `${code}\n\n>>> ${call}`;

const sourceFor = (candidate: OutputCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_GITHUB", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "PATH_HISTORY",
    authorSourceUrl: `${root}/commit/${candidate.authorCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, authorCommit: candidate.authorCommit,
    functionName: candidate.functionName, call: candidate.answer.call,
  };
  if (Object.keys(source).sort().join("|") !== [...OUTPUT_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

const worked = ({ call, output }: DoctestExample): string => `${call}${OUTPUT_HINT}${output}`;

/** The ranks of a candidate's answer among its four outputs, in each order a code-blind solver might rank them by. */
export const answerRanks = (candidate: Pick<OutputCandidate, "answer" | "decoys">): readonly number[] => {
  const outputs = [candidate.answer, ...candidate.decoys].map(({ output }) => output);
  return OUTPUT_ORDERS.map((order) => order(outputs).indexOf(candidate.answer.output));
};

/**
 * Whether a round may ask about one of its examples: its result does not repeat one of the call's arguments and, from
 * profile v6 on (#78), is not the only one of the four outputs that the arguments give away by case, rearrangement, or
 * reordering.
 */
export const askable = (examples: readonly DoctestExample[], index: number, version: ProfileVersion): boolean => {
  const { call, output } = examples[index]!;
  return !echoesArgument(call, output) && !(profileAtLeast(version, "local-real-rounds.v6")
    && transformGivesAway(call, output, examples.map((example) => example.output)));
};

/**
 * One answer per round, as an index into that round's examples, such that the answers fill every rank equally in
 * each order a solver might rank options by (numeric, else by length; and plain text), and every answer is askable.
 * From profile v6 on, picking the option that transforms the call's arguments also scores no more than chance and a
 * tenth over the rounds whose outputs are not numbers (#78). Each round has four examples and the pool a multiple of
 * four rounds. Deterministic; undefined when no such choice exists.
 */
export const balancedAnswers = (rounds: readonly (readonly DoctestExample[])[], version: ProfileVersion): readonly number[] | undefined => {
  if (rounds.some((examples) => examples.length !== OUTPUT_OPTIONS)) return undefined;
  const choices = rounds.map((examples) => {
    const outputs = examples.map(({ output }) => output);
    return examples.map(({ output }, index) => askable(examples, index, version)
      ? OUTPUT_ORDERS.map((order) => order(outputs).indexOf(output)) : undefined);
  });
  if (!profileAtLeast(version, "local-real-rounds.v6")) return balancedChoice(choices, OUTPUT_OPTIONS);
  const worded = rounds.map((examples) => !numericOutputs(examples.map(({ output }) => output)));
  const costs = rounds.map((examples, round) => examples.map(({ call, output }) =>
    [worded[round] ? transformScore(call, output, examples.map((example) => example.output)) : 0]));
  return balancedChoice(choices, OUTPUT_OPTIONS, [], { costs, limits: [transformLimit(worded.filter(Boolean).length)] });
};

const fixtureFor = (candidate: OutputCandidate, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!.output!.templates;
  const examples = [candidate.answer, ...candidate.decoys];
  if (candidate.decoys.length !== OUTPUT_OPTIONS - 1 || new Set(examples.map(({ output }) => output)).size !== OUTPUT_OPTIONS
    || new Set(examples.map(({ output }) => outputShape(output))).size !== 1
    || examples.some(({ call }) => !call.startsWith(`${candidate.functionName}(`))) fail();
  if (echoesArgument(candidate.answer.call, candidate.answer.output)) fail("OUTPUT_ANSWER_ECHOED");
  if (!askable(examples, 0, profile.profileVersion)) fail("OUTPUT_ANSWER_TRANSFORMED");
  const text = outputPane(candidate.code, candidate.answer.call);
  if (candidate.excerpt !== text || sha256(text) !== candidate.excerptHash) fail();
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("output", source);
  const hinted = shuffled(roundId, candidate.decoys, ({ call }) => call);
  const clues = Object.freeze(hinted.slice(0, 2).map(worked));
  // Options in the order a solver would rank them, so the answer's position is its balanced rank.
  const candidates = Object.freeze(outputOrder(examples.map(({ output }) => output))
    .map((label) => Object.freeze({ id: outputCandidateId(label), label, detail: null })));
  const panes = Object.freeze([Object.freeze({ label: null, text })]);
  return Object.freeze({
    kind: "OUTPUT",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: outputCandidateId(candidate.answer.output),
    evidence: fill(template.evidence, { path: candidate.path, repository: candidate.repository, call: candidate.answer.call, output: candidate.answer.output }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`The other options are this function's own results for other calls: ${hinted.map(worked).join("; ")}.`]),
    misleadingSignals: Object.freeze(["Results of the same function for nearby inputs look alike."]),
    source,
  });
};

/**
 * One output round per candidate. Each round offers its function's four outputs in rank order, and the pool's
 * answers fill every rank equally in that order and in text order, so no extreme and no fixed position is a better
 * guess than any other.
 */
export const generateOutputRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.output ?? fail();
  const candidates = options.candidates as readonly OutputCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  for (const order of OUTPUT_ORDERS.keys()) {
    const ranks = Array.from({ length: OUTPUT_OPTIONS }, (_, rank) => candidates.filter((candidate) => answerRanks(candidate)[order] === rank).length);
    if (Math.max(...ranks) - Math.min(...ranks) > 1) fail("OUTPUT_RANK_UNBALANCED");
  }
  for (const key of ["path", "blob", "rawContentHash", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  const fixtures = candidates.map((candidate) => fixtureFor(candidate, profile));
  if (profileAtLeast(profile.profileVersion, "local-real-rounds.v6")) {
    const worded = candidates.map(({ answer, decoys }) => [answer, ...decoys]).filter((examples) => !numericOutputs(examples.map(({ output }) => output)));
    const score = worded.reduce((sum, examples) => sum + transformScore(examples[0]!.call, examples[0]!.output, examples.map(({ output }) => output)), 0);
    if (score > transformLimit(worded.length) + SCORE_TOLERANCE) fail("OUTPUT_TRANSFORM_UNBALANCED");
  }
  return orderedPool(fixtures);
};
