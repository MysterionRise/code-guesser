import "server-only";

import { canonicalHash } from "../../../../packages/artifact/src/index";
import type { PublicModeContract } from "../components/arcade/mode-contract";
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

/** The date today's five is dealt for, `YYYY-MM-DD`. */
export const DEAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
/**
 * The source of randomness for today's five (#74): seeded by the artifact and the local date, so every load that day
 * deals the same rounds in the same order, and another day or another artifact deals differently.
 */
export const dailyRandom = (artifactHash: string, date: string): (() => number) => {
  if (!DEAL_DATE.test(date)) fail();
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

/**
 * How a game was dealt (#173), sealed in its token: a game of a seeded deal, today's five on a date, a friend's
 * challenge, or a draw nobody can repeat. A challenge's game names only the challenge; its seed stays sealed in it.
 */
export type DealDescriptor =
  | Readonly<{ kind: "series"; seed: string; game: number }>
  | Readonly<{ kind: "daily"; date: string }>
  | Readonly<{ kind: "duel"; challenge: string }>
  | Readonly<{ kind: "unseeded" }>;
/** Every key a descriptor may hold, for a JSON key list. */
export const DEAL_KEYS: readonly string[] = Object.freeze(["challenge", "date", "game", "kind", "seed"]);
/** A challenge's id (#173): 32 hex digits. */
const CHALLENGE_ID = /^[0-9a-f]{32}$/u;

/** A descriptor with exactly its kind's keys, each well formed, or null. */
export const parseDeal = (value: unknown): DealDescriptor | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const deal = value as Record<string, unknown>;
  const keys = Object.keys(deal).sort().join("|");
  const valid = deal.kind === "series"
    ? keys === "game|kind|seed" && typeof deal.seed === "string" && DEAL_SEED.test(deal.seed)
      && Number.isSafeInteger(deal.game) && (deal.game as number) >= 0 && (deal.game as number) <= MAXIMUM_GAME
    : deal.kind === "daily" ? keys === "date|kind" && typeof deal.date === "string" && DEAL_DATE.test(deal.date)
      : deal.kind === "duel" ? keys === "challenge|kind" && typeof deal.challenge === "string" && CHALLENGE_ID.test(deal.challenge)
        : deal.kind === "unseeded" && keys === "kind";
  return valid ? Object.freeze({ ...deal }) as DealDescriptor : null;
};

/**
 * A dealt game's digest (#173): its rounds with each one's options in the order dealt, and, when the game shows question
 * layers, each round's layer hash (null for a round without one), which fixes the hints it sells as well as its
 * scaffold. A friend's re-deal of a challenge must match it to the digit. It reads nothing the game hides but the
 * layers, and those only through their hashes.
 */
export const dealDigest = (mode: PublicModeContract, layers: readonly (string | null)[] | null): string => canonicalHash({
  rounds: mode.rounds.map(({ roundId, mode: { candidates } }) => [roundId, candidates.map(({ candidateId }) => candidateId)]),
  layers,
}).slice(0, 32);
