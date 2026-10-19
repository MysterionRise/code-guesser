import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { FACTORS, parseArms, type Arms } from "../experiment/arms";
import { ROUNDS_PER_SESSION, SESSION_DECK_IDS, type SessionDeckId } from "./local-real-experiment-domain.server";

/**
 * A game's progress, held by the server: the browser carries it only as a signed token it cannot alter, and the
 * ledger below refuses an older token for a game that has moved on, so each round takes one answer and every
 * score and hint count is the server's own.
 */
export interface GameState {
  readonly version: 2;
  /** Unguessable and random per deal; it links nothing beyond this one game. */
  readonly gameId: string;
  readonly artifactHash: string;
  readonly deck: SessionDeckId;
  /** The dealt rounds, in play order. */
  readonly roundIds: readonly string[];
  /** Accepted transitions so far: every bought hint and every answer is one. */
  readonly step: number;
  /** Rounds answered, which is also the index of the round being played. */
  readonly roundIndex: number;
  /** Hints bought for the round being played. */
  readonly hints: number;
  /**
   * Hints bought in each answered round, in play order, so an explanation can name only those the player saw
   * (the agent playtest's explanation judge found explanations citing hints the player never bought).
   */
  readonly hintsByRound: readonly number[];
  /** Rounds answered right so far. */
  readonly correct: number;
  readonly score: number;
  readonly dealtAt: number;
  /** When the round being played began: the deal, or the previous answer. Events measure time from it (#107). */
  readonly roundStartedAt: number;
  /** The experiment arms drawn at deal time (#106); the client can neither pick nor change them. */
  readonly arms: Arms;
  /** Whether this game's events are recorded: false when the browser sent `Sec-GPC: 1` at the deal. */
  readonly record: boolean;
}

/** Why a token was refused: it is not one this server issued for a live game, or the game has already moved past it. */
export type SessionRefusalReason = "SESSION_ENDED" | "STALE_STEP";

export class SessionRefusal extends Error {
  public constructor(public readonly reason: SessionRefusalReason) {
    super("GAME_SESSION_REFUSED");
    this.name = "SessionRefusal";
  }
}

/** A game is played in minutes; a token older than this is refused. */
export const GAME_TTL_MS = 6 * 60 * 60 * 1000;
/** Live games the ledger remembers; past this, the oldest are forgotten first. */
export const LEDGER_CAPACITY = 50_000;
/** A configured secret must be at least this long. */
export const MIN_SECRET_LENGTH = 32;
const MAC_CONTEXT = "codeguessr-game-session.v2";
const STATE_KEYS = ["arms", "artifactHash", "correct", "dealtAt", "deck", "gameId", "hints", "hintsByRound", "record", "roundIds", "roundIndex", "roundStartedAt", "score", "step", "version"];

interface SessionGlobals {
  secret?: Buffer;
  ledger?: Map<string, { step: number; expiresAt: number }>;
}

// Next builds each route into its own bundle, so module state is not shared between the page and its actions;
// the secret and the ledger live on the process instead.
const shared = (): SessionGlobals => {
  const key = Symbol.for("codeguessr.game-session");
  const holder = globalThis as unknown as Record<symbol, SessionGlobals | undefined>;
  return holder[key] ??= {};
};

/**
 * `CODEGUESSR_SESSION_SECRET` when set, so games survive a restart; otherwise a random secret for this process.
 * A configured secret that is too short is refused rather than weakened.
 */
const secret = (): Buffer => {
  const globals = shared();
  if (globals.secret) return globals.secret;
  const configured = process.env.CODEGUESSR_SESSION_SECRET;
  if (configured !== undefined && configured.length < MIN_SECRET_LENGTH) throw new Error("CODEGUESSR_SESSION_SECRET_TOO_SHORT");
  globals.secret = configured === undefined ? randomBytes(32) : Buffer.from(configured, "utf8");
  return globals.secret;
};

const ledger = () => shared().ledger ??= new Map();

const mac = (payload: string): Buffer => createHmac("sha256", secret()).update(`${MAC_CONTEXT}.${payload}`).digest();

export const newGameId = (): string => randomBytes(16).toString("hex");

const isCount = (value: unknown, maximum: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;

const parseState = (value: unknown): GameState => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SessionRefusal("SESSION_ENDED");
  const state = value as Record<string, unknown>;
  if (Object.keys(state).sort().join("|") !== STATE_KEYS.join("|")
    || state.version !== 2
    || typeof state.gameId !== "string" || !/^[0-9a-f]{32}$/u.test(state.gameId)
    || typeof state.artifactHash !== "string" || !/^[0-9a-f]{64}$/u.test(state.artifactHash)
    || !SESSION_DECK_IDS.includes(state.deck as SessionDeckId)
    || !Array.isArray(state.roundIds) || state.roundIds.length !== ROUNDS_PER_SESSION
    || state.roundIds.some((id) => typeof id !== "string" || id.length === 0)
    || !isCount(state.step, ROUNDS_PER_SESSION * 3)
    || !isCount(state.roundIndex, ROUNDS_PER_SESSION)
    || !isCount(state.hints, 2)
    || !Array.isArray(state.hintsByRound) || state.hintsByRound.length !== state.roundIndex
    || state.hintsByRound.some((count) => !isCount(count, 2))
    || !isCount(state.correct, state.roundIndex as number)
    || !isCount(state.score, Number.MAX_SAFE_INTEGER)
    || !isCount(state.dealtAt, Number.MAX_SAFE_INTEGER)
    || !isCount(state.roundStartedAt, Number.MAX_SAFE_INTEGER) || (state.roundStartedAt as number) < (state.dealtAt as number)
    || parseArms(state.arms) === null
    || typeof state.record !== "boolean") throw new SessionRefusal("SESSION_ENDED");
  return Object.freeze({ ...state, roundIds: Object.freeze([...state.roundIds]), hintsByRound: Object.freeze([...(state.hintsByRound as number[])]),
    arms: parseArms(state.arms)! }) as GameState;
};

/** The state as a token: its canonical JSON in base64url, a dot, and the HMAC of both under this server's secret. */
export const sealGame = (state: GameState): string => {
  // The key list orders the JSON and applies at every depth, so it names the arms' own keys too.
  const payload = Buffer.from(JSON.stringify(parseState(state), [...STATE_KEYS, ...Object.keys(FACTORS)].sort()), "utf8").toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
};

/** The state a token carries, when this server signed it, for this artifact, and it has not expired. */
export const openGame = (token: unknown, artifactHash: string, now: number): GameState => {
  if (typeof token !== "string" || token.length > 4096) throw new SessionRefusal("SESSION_ENDED");
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) throw new SessionRefusal("SESSION_ENDED");
  const expected = mac(payload);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SessionRefusal("SESSION_ENDED");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new SessionRefusal("SESSION_ENDED");
  }
  const state = parseState(value);
  if (state.artifactHash !== artifactHash || now < state.dealtAt || now - state.dealtAt > GAME_TTL_MS) {
    throw new SessionRefusal("SESSION_ENDED");
  }
  return state;
};

/** Records a game's latest step, forgetting expired games and then the oldest ones past the ledger's capacity. */
export const recordStep = (state: GameState, now: number, capacity = LEDGER_CAPACITY): void => {
  const entries = ledger();
  entries.delete(state.gameId);
  entries.set(state.gameId, { step: state.step, expiresAt: state.dealtAt + GAME_TTL_MS });
  for (const [gameId, entry] of entries) {
    if (entries.size <= capacity && entry.expiresAt >= now) break;
    entries.delete(gameId);
  }
};

/** The game a token holds, when it is the game's latest step; reading it changes nothing. */
export const readGame = (token: unknown, artifactHash: string, now: number): GameState => {
  const state = openGame(token, artifactHash, now);
  const known = ledger().get(state.gameId);
  // A game the ledger has forgotten (a restart, or capacity) continues from its token.
  if (known !== undefined && known.step !== state.step) throw new SessionRefusal("STALE_STEP");
  return state;
};

/**
 * Opens a token, refuses it if the game has already taken a later step, applies one transition, and records it.
 * Nothing here awaits, so two requests carrying the same token cannot both pass the check.
 */
export const advanceGame = <Result>(
  token: unknown,
  artifactHash: string,
  now: number,
  transition: (state: GameState) => { next: GameState; result: Result },
): { result: Result; token: string } => {
  const state = readGame(token, artifactHash, now);
  const { next, result } = transition(state);
  if (next.gameId !== state.gameId || next.step !== state.step + 1) throw new Error("GAME_TRANSITION_INVALID");
  const sealed = sealGame(next);
  recordStep(next, now);
  return { result, token: sealed };
};

/** Test support: forgets every recorded step. */
export const forgetAllGames = (): void => { ledger().clear(); };
