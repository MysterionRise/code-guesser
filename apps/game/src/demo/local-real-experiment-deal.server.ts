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
const DAY_MS = 86_400_000;
/**
 * The date a page's address asks today's five for (#172): the player's own, which only their browser knows
 * (`localDate` in `components/local-date.ts`). A real date within a day of the server's UTC date is dealt, which
 * covers every time zone from UTC−12 to UTC+14; any other is null, so no address deals a five that isn't today's
 * somewhere.
 */
export const dailyDateOf = (query: Readonly<Record<string, string | string[] | undefined>>, now: number): string | null => {
  const { date } = query;
  if (typeof date !== "string" || !DEAL_DATE.test(date)) return null;
  const day = Date.parse(`${date}T00:00:00Z`);
  // A date that doesn't exist, such as 2026-02-30, reads back as another day or none.
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== date) return null;
  return Math.abs(day - (now - (now % DAY_MS))) <= DAY_MS ? date : null;
};

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
