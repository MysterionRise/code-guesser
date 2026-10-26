import "server-only";

import type { EventSink } from "../experiment/event-store.server";
import { CLIENT_EVENT_TYPES, parsePayload, type EventOrigin, type EventType } from "../experiment/events";
import { ROUNDS_PER_SESSION } from "./local-real-experiment-domain.server";
import { GAME_TTL_MS, SessionRefusal, openGame, type GameState } from "./local-real-experiment-session.server";

/** How the game reports events (#107): the server's own, and the few a browser sends through the beacon route. */

/** Reports one event about a game, when the game records events and the server has somewhere to put them. */
export type Emit = (state: GameState, type: EventType, fields: Readonly<Record<string, string | number | boolean>>, now: number) => void;

/** Where a game came from (#173): a friend's game of a challenge is a duel's, and every other game a deal's. */
export const originOf = (state: GameState): EventOrigin => state.deal.kind === "duel" ? "duel" : "deal";

export const emitterFor = (sink: EventSink | null | undefined): Emit => (state, type, fields, now) => {
  if (sink && state.record) sink({ type, game: state.gameId, origin: originOf(state), deck: state.deck, arms: state.arms, fields }, now);
};

/**
 * Counts one browser event for a game and says whether it is within the game's allowance. The counts live on the
 * process, like the session ledger, and expire with the game.
 */
const countClientEvent = (gameId: string, dealtAt: number, now: number): boolean => {
  const key = Symbol.for("codeguessr.client-event-counts");
  const holder = globalThis as unknown as Record<symbol, Map<string, { count: number; expiresAt: number }> | undefined>;
  const counts = holder[key] ??= new Map();
  for (const [id, entry] of counts) if (entry.expiresAt < now) counts.delete(id);
  const entry = counts.get(gameId) ?? { count: 0, expiresAt: dealtAt + GAME_TTL_MS };
  if (entry.count >= CLIENT_EVENTS_PER_GAME) return false;
  counts.set(gameId, { ...entry, count: entry.count + 1 });
  return true;
};

/** Milliseconds between two moments, bounded to the one day an event's duration may span. */
export const elapsed = (from: number, to: number): number => Math.min(Math.max(to - from, 0), 86_400_000);

export type ClientEventOutcome = "RECORDED" | "REJECTED" | "SESSION_ENDED" | "LIMIT";

/** Browser events one game may send; past this the beacon route answers 429. */
export const CLIENT_EVENTS_PER_GAME = 60;

/**
 * Records one event only a browser sees, for a game this server dealt and that has not expired. It names a round
 * already reached, and a game takes a bounded number of them.
 */
export const recordClientEvent = (value: unknown, artifactHash: string, now: number, emit: Emit): ClientEventOutcome => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "REJECTED";
  const { sessionToken, event, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0 || typeof event !== "object" || event === null || Array.isArray(event)) return "REJECTED";
  const { type, ...fields } = event as Record<string, unknown>;
  if (!(CLIENT_EVENT_TYPES as readonly unknown[]).includes(type)) return "REJECTED";
  const payload = parsePayload(type, fields);
  if (payload === null) return "REJECTED";
  let state: GameState;
  try {
    state = openGame(sessionToken, artifactHash, now);
  } catch (error) {
    return error instanceof SessionRefusal && error.reason === "SESSION_ENDED" ? "SESSION_ENDED" : "REJECTED";
  }
  // A round event names a round the game has reached; a token may be a step behind the browser's view.
  if (typeof payload.round === "number" && payload.round > Math.min(state.roundIndex + 1, ROUNDS_PER_SESSION)) return "REJECTED";
  if (!countClientEvent(state.gameId, state.dealtAt, now)) return "LIMIT";
  emit(state, type as EventType, payload, now);
  return "RECORDED";
};
