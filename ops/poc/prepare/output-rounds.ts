import { canonicalHash } from "./canonical";
import type { DoctestExample } from "./doctest-parse";
import { deepFreeze } from "./model-validation";
import {
  OUTPUT_HINT, OUTPUT_ORDERS, OUTPUT_SOURCE_KEYS, echoesArgument, outputCandidateId, outputOrder, outputShape, type ExperimentFixture,
} from "./model";
import { OUTPUT_OPTIONS, type CrawlProfile } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, type GeneratedRounds } from "./round-helpers";

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

/** How many choices the answer search may try before it gives up on a pool. */
const SEARCH_LIMIT = 200_000;

/**
 * One answer per round, as an index into that round's examples, such that the answers fill every rank equally in
 * each order a solver might rank options by (numeric, else by length; and plain text), and no answer repeats one of
 * its call's arguments. Each round has four examples and the pool a multiple of four rounds. Deterministic;
 * undefined when no such choice exists.
 */
export const balancedAnswers = (rounds: readonly (readonly DoctestExample[])[]): readonly number[] | undefined => {
  if (rounds.length % OUTPUT_OPTIONS !== 0 || rounds.some((examples) => examples.length !== OUTPUT_OPTIONS)) return undefined;
  const quota = rounds.length / OUTPUT_OPTIONS;
  const counts = OUTPUT_ORDERS.map(() => Array.from({ length: OUTPUT_OPTIONS }, () => 0));
  const ranked = rounds.map((examples) => {
    const outputs = examples.map(({ output }) => output);
    return examples.map(({ call, output }) => echoesArgument(call, output) ? undefined : OUTPUT_ORDERS.map((order) => order(outputs).indexOf(output)));
  });
  const choice: number[] = [];
  let tries = 0;
  const visit = (index: number): boolean => {
    if (index === rounds.length) return true;
    // Each round first tries the next rank in turn, so most rounds settle without backtracking.
    for (let step = 0; step < OUTPUT_OPTIONS; step += 1) {
      const pick = ranked[index]!.findIndex((ranks) => ranks?.[0] === (index + step) % OUTPUT_OPTIONS);
      const ranks = ranked[index]![pick];
      if (!ranks || ranks.some((rank, order) => counts[order]![rank]! >= quota) || (tries += 1) > SEARCH_LIMIT) continue;
      ranks.forEach((rank, order) => { counts[order]![rank]! += 1; });
      choice.push(pick);
      if (visit(index + 1)) return true;
      ranks.forEach((rank, order) => { counts[order]![rank]! -= 1; });
      choice.pop();
    }
    return false;
  };
  return visit(0) && tries <= SEARCH_LIMIT ? Object.freeze(choice) : undefined;
};

const fixtureFor = (candidate: OutputCandidate, profile: CrawlProfile): ExperimentFixture => {
  const template = profile.curated!.output!.templates;
  const examples = [candidate.answer, ...candidate.decoys];
  if (candidate.decoys.length !== OUTPUT_OPTIONS - 1 || new Set(examples.map(({ output }) => output)).size !== OUTPUT_OPTIONS
    || new Set(examples.map(({ output }) => outputShape(output))).size !== 1
    || examples.some(({ call }) => !call.startsWith(`${candidate.functionName}(`))) fail();
  if (echoesArgument(candidate.answer.call, candidate.answer.output)) fail("OUTPUT_ANSWER_ECHOED");
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
  return orderedPool(candidates.map((candidate) => fixtureFor(candidate, profile)));
};
