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
 * What tells a round's company in a game (#233): its option set (`family`, the same for every round of an algorithm
 * or exercise family, or of a project group) and its answer. A game of five holds each family once, and each answer
 * once, as far as the pool allows.
 */
export interface RoundKeys {
  readonly family: string;
  readonly answer: string;
}
type Keyed<Round> = Readonly<{ round: Round } & RoundKeys>;

/**
 * A pass's order arranged for its games (#233): walking the seeded order, each slot takes the first round whose
 * family the game doesn't hold yet, and whose answer it doesn't either, so no game of a six-family deck shows one
 * family twice, and a four-family deck's forced repeat at least answers differently. A family with as many rounds
 * left as games that can still take one is urgent and goes first, so a pass never ends on a game of one family;
 * otherwise the seeded order stands, and a deck of singleton option sets keeps its order almost whole. A game that
 * straddles two passes carries what it already holds (`carried`) into the next pass's first, shorter block. A pool
 * of one family (before-after) is left as it is, since any rule on its two answers would make a pattern.
 */
const arrangeForGames = <Round>(order: readonly Round[], keys: (round: Round) => RoundKeys, firstBlock: number, carried: readonly RoundKeys[]): readonly Round[] => {
  const remaining: Keyed<Round>[] = order.map((round) => Object.freeze({ round, ...keys(round) }));
  const left = new Map<string, number>();
  for (const { family } of remaining) left.set(family, (left.get(family) ?? 0) + 1);
  if (left.size < 2) return order;
  const arranged: Round[] = [];
  let families = new Set(carried.map(({ family }) => family));
  let answers = new Set(carried.map(({ answer }) => answer));
  let slots = firstBlock;
  const RANK = 1_000;
  // How well a round fits the game being filled: an urgent family above all, then a new family with a new answer, a
  // new family, and last a family the game already holds, where the fullest family goes first so none runs out before
  // the pass ends (a four-family deck repeats one every game) and a new answer beats a repeated one. Equal fits keep
  // the seeded order.
  const fit = ({ family, answer }: Keyed<Round>): number => {
    const count = left.get(family)!;
    if (families.has(family)) return (answers.has(answer) ? -RANK : 0) + count;
    const gamesAhead = Math.ceil(Math.max(0, remaining.length - slots) / ROUNDS_PER_SESSION);
    return count >= gamesAhead + 1 ? 3 * RANK + count : answers.has(answer) ? RANK : 2 * RANK;
  };
  while (remaining.length > 0) {
    if (slots === 0) {
      families = new Set();
      answers = new Set();
      slots = ROUNDS_PER_SESSION;
    }
    let best = 0;
    let leads = fit(remaining[0]!);
    for (let index = 1; index < remaining.length; index += 1) {
      const fits = fit(remaining[index]!);
      if (fits > leads) {
        best = index;
        leads = fits;
      }
    }
    const [pick] = remaining.splice(best, 1) as [Keyed<Round>];
    arranged.push(pick.round);
    families.add(pick.family);
    answers.add(pick.answer);
    left.set(pick.family, left.get(pick.family)! - 1);
    slots -= 1;
  }
  return Object.freeze(arranged);
};

/**
 * Game `game` of a deal (#40): positions 5·game to 5·game + 4 of the pool in an order the seed fixes, so a deal's games
 * share no round until the pool is spent. Each pass through the pool takes a fresh order, arranged so that each game
 * holds each option family once where the pool allows (#233, with `keys`); a game that spans two passes skips a round
 * it already holds. `wrapped` says this game starts a new pass: the pool ran out just before it or within it.
 */
export const seriesRounds = <Round>(pool: readonly Round[], seed: string, deck: string, game: number, keys?: (round: Round) => RoundKeys): Readonly<{ rounds: readonly Round[]; wrapped: boolean }> => {
  if (!DEAL_SEED.test(seed) || !Number.isSafeInteger(game) || game < 0 || game > MAXIMUM_GAME || pool.length < ROUNDS_PER_SESSION) fail();
  const passes = new Map<number, readonly Round[]>();
  const pass = (index: number): readonly Round[] => {
    const known = passes.get(index);
    if (known !== undefined) return known;
    const order = shuffle(pool, seededRandom({ seed, deck, pass: index }));
    // How many of the game that straddles this pass's start lie in the pass before, and which rounds they are.
    const straddle = (index * pool.length) % ROUNDS_PER_SESSION;
    const carried = keys === undefined || straddle === 0 ? [] : pass(index - 1).slice(-straddle).map(keys);
    const arranged = keys === undefined ? order : arrangeForGames(order, keys, straddle === 0 ? ROUNDS_PER_SESSION : ROUNDS_PER_SESSION - straddle, carried);
    passes.set(index, arranged);
    return arranged;
  };
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

/** A deck as the mix draws from it: its id and its pool. */
export interface MixedDeck<Round> {
  readonly id: string;
  readonly rounds: readonly Round[];
}
/**
 * Game `game` of a seeded mixed deal (#56, #40): five decks in an order the seed fixes, cycling through every deck before
 * any comes round again, and from each deck its next round in that deck's own seeded order, so a deal's mixed games
 * share no round until a deck's pool is spent. `wrapped` says a deck's pool ran out just before this game or within
 * it, so one of its rounds comes round again.
 */
export const mixedSeriesRounds = <Round>(decks: readonly MixedDeck<Round>[], seed: string, game: number): Readonly<{ rounds: readonly Round[]; wrapped: boolean }> => {
  if (!DEAL_SEED.test(seed) || !Number.isSafeInteger(game) || game < 0 || game > MAXIMUM_GAME || decks.length < ROUNDS_PER_SESSION
    || decks.some(({ rounds }) => rounds.length === 0) || new Set(decks.map(({ id }) => id)).size !== decks.length) fail();
  const deckPasses = new Map<number, readonly MixedDeck<Round>[]>();
  const deckPass = (index: number) => deckPasses.get(index) ?? deckPasses.set(index, shuffle(decks, seededRandom({ seed, deck: "mixed", pass: index }))).get(index)!;
  const orders = new Map<string, readonly Round[]>();
  const uses = new Map<string, number>();
  const rounds: Round[] = [];
  let wrapped = false;
  for (let index = 0; index <= game; index += 1) {
    const picks: MixedDeck<Round>[] = [];
    for (let position = ROUNDS_PER_SESSION * index; picks.length < ROUNDS_PER_SESSION; position += 1) {
      const deck = deckPass(Math.floor(position / decks.length))[position % decks.length]!;
      if (!picks.includes(deck)) picks.push(deck);
    }
    for (const deck of picks) {
      const use = uses.get(deck.id) ?? 0;
      uses.set(deck.id, use + 1);
      if (index !== game) continue;
      const pass = Math.floor(use / deck.rounds.length);
      const key = `${deck.id}#${pass}`;
      const order = orders.get(key) ?? orders.set(key, shuffle(deck.rounds, seededRandom({ seed, deck: deck.id, mixed: true, pass }))).get(key)!;
      rounds.push(order[use % deck.rounds.length]!);
      if (use > 0 && use % deck.rounds.length === 0) wrapped = true;
    }
  }
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
