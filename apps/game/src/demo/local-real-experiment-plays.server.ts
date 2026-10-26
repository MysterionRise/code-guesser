import "server-only";

import { PLAYS_CAPACITY, stateStore } from "../server/state-store.server";
import { canonicalHash } from "./local-real-experiment-validation.server";
import { MAXIMUM_PLAYS, type GameState } from "./local-real-experiment-session.server";

/**
 * The plays ledger (#173): how many games of each seeded deal, and of each challenge, revealed a round. It counts
 * games, never players: a key names a deal or a challenge and nothing else, so a challenge can say whether its game
 * was the deal's first try, and a friend's result which play of the link it was. Today's five is everyone's same
 * game, so it isn't counted.
 */

interface PlaysGlobals {
  counts?: Map<string, number>;
}

// Like the session ledger, the counts live on the process, since Next builds each route into its own bundle.
const shared = (): PlaysGlobals => {
  const key = Symbol.for("codeguessr.plays");
  const holder = globalThis as unknown as Record<symbol, PlaysGlobals | undefined>;
  return holder[key] ??= {};
};

const counts = () => shared().counts ??= new Map();

/** The key a game's plays are counted under: its deal's for a game of a seeded deal, its challenge's for a duel. */
export const playsKey = ({ artifactHash, deck, deal }: Pick<GameState, "artifactHash" | "deck" | "deal">): string | null =>
  deal.kind === "series" ? canonicalHash({ artifact: artifactHash, deck, seed: deal.seed, game: deal.game })
    : deal.kind === "duel" ? deal.challenge
      : null;

/** The count recorded for a key, or undefined when neither memory nor the state store holds one. */
const recorded = (key: string): number | undefined => counts().get(key) ?? stateStore()?.plays(key);

/**
 * Records a key's count, written through to the state store (`CODEGUESSR_STATE_DIR`, #164) first when there is one;
 * memory forgets the counts touched longest ago past its capacity, as the store does.
 */
const record = (key: string, count: number, now: number, capacity: number): void => {
  stateStore()?.recordPlays(key, count, now);
  const entries = counts();
  entries.delete(key);
  entries.set(key, count);
  for (const oldest of entries.keys()) {
    if (entries.size <= capacity) break;
    entries.delete(oldest);
  }
};

/** How many games of this key revealed a round, up to `MAXIMUM_PLAYS`. */
export const playsOf = (key: string | null): number => key === null ? 0 : Math.min(recorded(key) ?? 0, MAXIMUM_PLAYS);

/**
 * Counts a game as one play of its deal or challenge, at its first reveal, so a page that was dealt and never played
 * counts for nothing; a game reaches its first reveal once. Returns the game's `priorPlays` from then on: the games
 * that revealed a round before it, which can only have grown since its deal.
 */
export const countPlay = (state: GameState, now: number, capacity = PLAYS_CAPACITY): number => {
  const key = playsKey(state);
  if (key === null) return state.priorPlays;
  const prior = recorded(key) ?? 0;
  record(key, prior + 1, now, capacity);
  return Math.min(Math.max(prior, state.priorPlays), MAXIMUM_PLAYS);
};

/** Notes a challenge as issued, once: true the first time, so a game's second challenge link is known as such. */
export const markIssued = (challengeId: string, now: number, capacity = PLAYS_CAPACITY): boolean => {
  if (recorded(challengeId) !== undefined) return false;
  record(challengeId, 0, now, capacity);
  return true;
};

/** Test support: forgets every count held in memory, as a restart does; a state store keeps its own. */
export const forgetAllPlays = (): void => { counts().clear(); };
