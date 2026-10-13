import { createHash } from "node:crypto";

import { canonicalHash } from "./canonical";
import { SCORE_TOLERANCE, type ExperimentFixture } from "./model";

/** A deck's pool of fixtures, in round-identity order so pool order says nothing about answers. */
export interface GeneratedRounds {
  readonly fixtures: readonly ExperimentFixture[];
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Deterministic, data-dependent order: by hash of a seed and each item's own identity. */
export const shuffled = <Item>(seed: string, items: readonly Item[], key: (item: Item) => string): readonly Item[] =>
  Object.freeze([...items].sort((left, right) => {
    const a = canonicalHash({ seed, item: key(left) });
    const b = canonicalHash({ seed, item: key(right) });
    return a < b ? -1 : a > b ? 1 : 0;
  }));

export const attributionFor = (source: Readonly<Record<string, unknown>>): string => [
  source.authorName, source.repository, `${String(source.licenseName)} (${String(source.licenseSpdx)})`, source.blobUrl,
].map(String).join(" · ");

/** Fills `{name}` placeholders; every placeholder in the template must be supplied exactly once. */
export const fill = (template: string, values: Readonly<Record<string, string>>): string => {
  let result = template;
  for (const [name, value] of Object.entries(values)) {
    const token = `{${name}}`;
    if (result.split(token).length !== 2) throw new Error("TEMPLATE_PLACEHOLDER_REJECTED");
    result = result.replace(token, value);
  }
  if (/\{[a-z]+\}/u.test(result)) throw new Error("TEMPLATE_PLACEHOLDER_REJECTED");
  return result;
};

/** A stable round identity from the round kind and its source's identity. */
export const roundIdFor = (kind: string, source: Readonly<Record<string, unknown>>): string =>
  `local-${kind}-${canonicalHash({ kind, repository: source.repository, commit: source.commit, path: source.path, blob: source.blob }).slice(0, 24)}`;

/** Orders a pool by round identity, so neither selection order nor source order shows through. */
export const orderedPool = (fixtures: readonly ExperimentFixture[]): GeneratedRounds => Object.freeze({
  fixtures: Object.freeze([...fixtures].sort((left, right) => left.roundId < right.roundId ? -1 : left.roundId > right.roundId ? 1 : 0)),
});

/** A count rounded to two significant figures and grouped, for a hint such as "about 73,000". */
export const approximately = (value: number): string => {
  if (value < 100) return String(value);
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return (Math.round(value / magnitude) * magnitude).toLocaleString("en-US");
};

/** The source record a fixture stores: everything the candidate carries except its public text. */
export const sourceRecord = (candidate: Readonly<Record<string, unknown>>, omit: readonly string[]): Readonly<Record<string, unknown>> =>
  Object.freeze(structuredClone(Object.fromEntries(Object.entries(candidate).filter(([key]) => !omit.includes(key)))));

/** How many choices a balancing search may try before it gives up on a pool. */
const BALANCE_SEARCH_LIMIT = 500_000;

/**
 * Scores each choice adds, such as what a solver wins on that round (`costs[round][choice][score]`), and the most
 * each kind of score may add up to over the chosen rounds (`limits[score]`).
 */
export interface ChoiceBudget {
  readonly costs: readonly (readonly (readonly number[])[])[];
  readonly limits: readonly number[];
}

/**
 * One choice per round, where each choice gives the answer's rank in every order a code-blind solver might rank
 * options by, such that in each order no rank is taken more than `rounds.length / ranks` times, plus that order's
 * `slack` (none by default, which makes every rank equally often), and each kind of score in a `budget`, if given,
 * adds up to no more than its limit. An undefined choice is not allowed. Choices with the same ranks and scores are
 * interchangeable, so each round keeps its first of each and tries the lowest-scoring first; rounds with the fewest
 * options are placed first, and each round first tries the rank next in turn. Deterministic; undefined when no
 * choice exists.
 */
export const balancedChoice = (
  rounds: readonly (readonly (readonly number[] | undefined)[])[],
  ranks: number,
  slack: readonly number[] = [],
  budget?: ChoiceBudget,
): readonly number[] | undefined => {
  if (rounds.length % ranks !== 0) return undefined;
  const quota = rounds.length / ranks;
  const limits = budget?.limits ?? [];
  const costOf = (round: number, choice: number): readonly number[] => limits.map((_, score) => budget!.costs[round]![choice]![score]!);
  const total = (costs: readonly number[]): number => costs.reduce((sum, cost) => sum + cost, 0);
  const distinct = rounds.map((choices, round) => {
    const seen = new Map<string, Readonly<{ choice: number; vector: readonly number[]; costs: readonly number[] }>>();
    choices.forEach((vector, choice) => {
      if (!vector) return;
      const costs = costOf(round, choice);
      const key = `${vector.join(",")}:${costs.join(",")}`;
      if (!seen.has(key)) seen.set(key, Object.freeze({ choice, vector, costs }));
    });
    return [...seen.values()].sort((left, right) => total(left.costs) - total(right.costs));
  });
  const orders = distinct.flatMap((options) => options.map(({ vector }) => vector.length))[0] ?? 0;
  if (distinct.some((options) => options.some(({ vector }) => vector.length !== orders))) return undefined;
  const sequence = distinct.map((_, index) => index).sort((left, right) => distinct[left]!.length - distinct[right]!.length || left - right);
  // The least each score can still add from each position on, so a search that cannot stay in budget stops early.
  const floors = sequence.map((_, position) => limits.map((_limit, score) => sequence.slice(position)
    .reduce((sum, round) => sum + Math.min(...distinct[round]!.map(({ costs }) => costs[score]!)), 0)));
  const overBudget = (spent: readonly number[]): boolean => spent.some((sum, score) => sum > limits[score]! + SCORE_TOLERANCE);
  const counts = Array.from({ length: orders }, () => Array.from({ length: ranks }, () => 0));
  const spent = limits.map(() => 0);
  const picked = new Map<number, number>();
  let tries = 0;
  const visit = (position: number): boolean => {
    if (position === sequence.length) return true;
    if (overBudget(spent.map((sum, score) => sum + floors[position]![score]!))) return false;
    const round = sequence[position]!;
    for (let step = 0; step < ranks; step += 1) {
      for (const { choice, vector, costs } of distinct[round]!) {
        if (vector[0] !== (position + step) % ranks || overBudget(spent.map((sum, score) => sum + costs[score]!))) continue;
        if (vector.some((rank, order) => counts[order]![rank]! >= quota + (slack[order] ?? 0)) || (tries += 1) > BALANCE_SEARCH_LIMIT) continue;
        vector.forEach((rank, order) => { counts[order]![rank]! += 1; });
        costs.forEach((cost, score) => { spent[score]! += cost; });
        picked.set(round, choice);
        if (visit(position + 1)) return true;
        vector.forEach((rank, order) => { counts[order]![rank]! -= 1; });
        costs.forEach((cost, score) => { spent[score]! -= cost; });
        picked.delete(round);
      }
    }
    return false;
  };
  return visit(0) && tries <= BALANCE_SEARCH_LIMIT ? Object.freeze(rounds.map((_, index) => picked.get(index)!)) : undefined;
};
