import "server-only";

import { canonicalHash } from "../../../../packages/artifact/src/index";
import { ROUNDS_PER_SESSION, fail } from "./local-real-experiment-domain.server";

/** Fisher-Yates with an injectable source of randomness, so tests can deal a known session. */
export const shuffle = <Item>(items: readonly Item[], random: () => number): Item[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
};

/** A source of randomness seeded by these values: mulberry32 over their canonical hash, the same on every machine. */
export const seededRandom = (seed: unknown): (() => number) => {
  let state = Number.parseInt(canonicalHash(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/**
 * The source of randomness for today's five (#74): seeded by the artifact and the local date, so every load that day
 * deals the same rounds in the same order, and another day or another artifact deals differently.
 */
export const dailyRandom = (artifactHash: string, date: string): (() => number) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail();
  return seededRandom({ artifactHash, date });
};
/** A date as the player's machine names it, `YYYY-MM-DD`. */
export const localDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The mix's rounds: five decks drawn at random, and one round drawn from each. */
export const mixedRounds = <Round>(decks: readonly Readonly<{ rounds: readonly Round[] }>[], random: () => number): readonly Round[] =>
  shuffle(decks, random).slice(0, ROUNDS_PER_SESSION).map(({ rounds }) => rounds[Math.floor(random() * rounds.length)]!);

/** One game of a seeded deal (#40): its seed and which game it is, counted from 0. */
export interface DealSeries {
  readonly seed: string;
  readonly game: number;
}
/** A deal's seed (#40): eight hex digits, carried in the page's address so a reload deals the same game. */
export const DEAL_SEED = /^[0-9a-f]{8}$/u;
/** The most games a deal counts to; the pool wraps long before. */
export const MAXIMUM_GAME = 999;
/**
 * Game `game` of a deal (#40): positions 5·game to 5·game + 4 of the pool in an order the seed fixes, so a deal's games
 * share no round until the pool is spent. Each pass through the pool takes a fresh order; a game that spans two
 * passes skips a round it already holds. `wrapped` says this game starts a new pass: the pool ran out just before it or
 * within it.
 */
export const seriesRounds = <Round>(pool: readonly Round[], seed: string, deck: string, game: number): Readonly<{ rounds: readonly Round[]; wrapped: boolean }> => {
  if (!DEAL_SEED.test(seed) || !Number.isSafeInteger(game) || game < 0 || game > MAXIMUM_GAME || pool.length < ROUNDS_PER_SESSION) fail();
  const passes = new Map<number, readonly Round[]>();
  const pass = (index: number) => passes.get(index) ?? passes.set(index, shuffle(pool, seededRandom({ seed, deck, pass: index }))).get(index)!;
  const rounds: Round[] = [];
  const first = ROUNDS_PER_SESSION * game;
  let position = first;
  for (; rounds.length < ROUNDS_PER_SESSION; position += 1) {
    const round = pass(Math.floor(position / pool.length))[position % pool.length]!;
    if (!rounds.includes(round)) rounds.push(round);
  }
  const wrapped = Math.floor((position - 1) / pool.length) > Math.floor(first / pool.length) || (first > 0 && first % pool.length === 0);
  return Object.freeze({ rounds: Object.freeze(rounds), wrapped });
};
