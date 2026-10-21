import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type { DuelRound, FirstPlay } from "../components/duel/duel-contract";
import { parseArms, type Arms } from "../experiment/arms";
import { DEAL_DATE, parseDeal, type DealDescriptor } from "./local-real-experiment-deal.server";
import {
  CANDIDATE_COUNTS,
  DAILY_DECK,
  ROUNDS_PER_SESSION,
  SESSION_DECK_IDS,
  roundPoints,
  type SessionDeckId,
} from "./local-real-experiment-domain.server";
import { MAXIMUM_PLAYS, deriveKey } from "./local-real-experiment-session.server";

/**
 * Duel links (#173): a challenge and its result, each sealed with AES-256-GCM under a key of its own derived from the
 * session secret, so a friend can read neither, and a challenge can't pass for a result or the reverse. Encryption,
 * not only a signature, keeps the challenger's seed from the friend, who could otherwise play the deal first. A link
 * holds how each round went and never a round, an option, an answer, a game's id, or a name.
 */

export const CHALLENGE_CONTEXT = "codeguessr-duel.v1";
export const RESULT_CONTEXT = "codeguessr-duel-result.v1";
const ID_CONTEXT = "codeguessr-duel-id.v1";
/** A challenge deals for a week from its issue, and a result shows for thirty days. */
export const CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A link's token is at most this long, and only base64url; anything else is refused before it is decoded. */
export const MAX_TOKEN_LENGTH = 1024;
const TOKEN = /^[A-Za-z0-9_-]+$/u;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A challenge, as its link carries it sealed. */
export interface ChallengeClaims {
  readonly v: 1;
  /** The challenge's id: a keyed hash of the challenger's game id, which links to nothing outside this server. */
  readonly id: string;
  /** The first 16 hex digits of the artifact's hash, so a link for an earlier round set is told apart. */
  readonly artifact: string;
  readonly deck: SessionDeckId;
  /** A seeded deal's game, or today's five on its date: what the friend is dealt again. */
  readonly deal: Extract<DealDescriptor, { kind: "series" | "daily" }>;
  /** The challenger's `dealDigest`, which the friend's re-deal must match. */
  readonly digest: string;
  /** The challenger's arms, so the friend sees the same theme, scaffolds, and hints. */
  readonly arms: Arms;
  readonly rounds: readonly DuelRound[];
  readonly max: number;
  readonly firstPlay: FirstPlay;
  /** When it was issued, in ms. */
  readonly at: number;
}

/** A duel's result, as its link carries it sealed: both games' rounds, and nothing that deals either again. */
export interface ResultClaims {
  readonly v: 1;
  readonly id: string;
  readonly artifact: string;
  readonly deck: SessionDeckId;
  readonly date: string | null;
  readonly max: number;
  readonly challenger: Readonly<{ rounds: readonly DuelRound[]; firstPlay: FirstPlay }>;
  readonly challenged: Readonly<{ rounds: readonly DuelRound[]; play: number }>;
  readonly at: number;
}

/** Why a link was refused: not one this server sealed in this context, past its life, or for another round set. */
export type DuelTokenRefusalReason = "INVALID" | "EXPIRED" | "ROUND_SET";

export class DuelTokenRefusal extends Error {
  public constructor(public readonly reason: DuelTokenRefusalReason) {
    super("DUEL_TOKEN_REFUSED");
    this.name = "DuelTokenRefusal";
  }
}

/** Points a round can score: none, or a right answer's after zero, one, or two hints, for any deck's option count. */
const POINTS: ReadonlySet<unknown> = new Set([0,
  ...Object.values(CANDIDATE_COUNTS).flatMap((count) => [0, 1, 2].map((hints) => roundPoints(count, hints)))]);
/** The most a game can score: five rounds at the most any round is worth. */
export const MAXIMUM_SCORE = ROUNDS_PER_SESSION * Math.max(...[...POINTS].map(Number));
const FIRST_PLAYS: readonly unknown[] = ["yes", "no", "shared"];

/** The challenge id for a game: stable for the game, and unlinkable to its id, and so to its events, without the secret. */
export const challengeId = (gameId: string): string =>
  createHmac("sha256", deriveKey(ID_CONTEXT)).update(`${ID_CONTEXT}.${gameId}`).digest("hex").slice(0, 32);

/** The part of an artifact's hash a link names. */
export const artifactPrefix = (artifactHash: string): string => artifactHash.slice(0, 16);

const hasKeys = (value: unknown, keys: string): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join("|") === keys;
const isHex = (value: unknown, length: number): value is string =>
  typeof value === "string" && value.length === length && /^[0-9a-f]+$/u.test(value);
const isMoment = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isDeck = (value: unknown): value is SessionDeckId => SESSION_DECK_IDS.includes(value as SessionDeckId);
const isMax = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAXIMUM_SCORE;

/**
 * Five rounds of `[correct, hints, points]`: a round scores points exactly when it was right, only points some round
 * can score, and no more in all than the game's best. Anything else is null.
 */
const parseRounds = (value: unknown, max: number): readonly DuelRound[] | null => {
  if (!Array.isArray(value) || value.length !== ROUNDS_PER_SESSION) return null;
  const rounds = value.map((round: unknown) => Array.isArray(round) && round.length === 3 && (round[0] === 0 || round[0] === 1)
    && (round[1] === 0 || round[1] === 1 || round[1] === 2) && POINTS.has(round[2]) && (round[2] === 0) === (round[0] === 0)
    ? Object.freeze([round[0], round[1], round[2]] as const) as DuelRound : null);
  if (rounds.some((round) => round === null)) return null;
  return rounds.reduce((total, round) => total + round![2], 0) <= max ? Object.freeze(rounds as DuelRound[]) : null;
};

/** A challenge with exactly its keys, each well formed, or null. */
export const parseChallenge = (value: unknown): ChallengeClaims | null => {
  if (!hasKeys(value, "arms|artifact|at|deal|deck|digest|firstPlay|id|max|rounds|v") || value.v !== 1 || !isHex(value.id, 32)
    || !isHex(value.artifact, 16) || !isDeck(value.deck) || !isHex(value.digest, 32) || !isMax(value.max)
    || !FIRST_PLAYS.includes(value.firstPlay) || !isMoment(value.at)) return null;
  const deal = parseDeal(value.deal);
  const arms = parseArms(value.arms);
  const rounds = parseRounds(value.rounds, value.max);
  // Today's five deals the same game to everyone, so its challenge is always `shared`, and only it is.
  if (deal === null || (deal.kind !== "series" && deal.kind !== "daily") || (deal.kind === "daily" && value.deck !== DAILY_DECK)
    || (deal.kind === "daily") !== (value.firstPlay === "shared") || arms === null || rounds === null) return null;
  return Object.freeze({ v: 1, id: value.id, artifact: value.artifact, deck: value.deck, deal, digest: value.digest, arms, rounds,
    max: value.max, firstPlay: value.firstPlay as FirstPlay, at: value.at });
};

/** A result with exactly its keys, each well formed, or null. */
export const parseResult = (value: unknown): ResultClaims | null => {
  if (!hasKeys(value, "artifact|at|challenged|challenger|date|deck|id|max|v") || value.v !== 1 || !isHex(value.id, 32)
    || !isHex(value.artifact, 16) || !isDeck(value.deck) || !isMax(value.max) || !isMoment(value.at)
    || !(value.date === null || (typeof value.date === "string" && DEAL_DATE.test(value.date) && value.deck === DAILY_DECK))) return null;
  const { challenger, challenged } = value;
  // A result of today's five names its date, and only it is `shared`.
  if (!hasKeys(challenger, "firstPlay|rounds") || !FIRST_PLAYS.includes(challenger.firstPlay)
    || (value.date !== null) !== (challenger.firstPlay === "shared") || !hasKeys(challenged, "play|rounds") || !Number.isSafeInteger(challenged.play) || (challenged.play as number) < 1
    || (challenged.play as number) > MAXIMUM_PLAYS + 1) return null;
  const [mine, theirs] = [parseRounds(challenger.rounds, value.max), parseRounds(challenged.rounds, value.max)];
  if (mine === null || theirs === null) return null;
  return Object.freeze({ v: 1, id: value.id, artifact: value.artifact, deck: value.deck, date: value.date as string | null, max: value.max,
    challenger: Object.freeze({ rounds: mine, firstPlay: challenger.firstPlay as FirstPlay }),
    challenged: Object.freeze({ rounds: theirs, play: challenged.play as number }), at: value.at });
};

/** Claims as a token: base64url of the IV, the ciphertext, and the tag, sealed under the context's key and named by it. */
const seal = (context: string, claims: object): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(context), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  const token = Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("DUEL_TOKEN_TOO_LONG");
  return token;
};

/** What a token holds, when this server sealed it in this context; anything else is `INVALID`. */
const open = (context: string, token: unknown): unknown => {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !TOKEN.test(token)) throw new DuelTokenRefusal("INVALID");
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length <= IV_BYTES + TAG_BYTES) throw new DuelTokenRefusal("INVALID");
  const key = deriveKey(context);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new DuelTokenRefusal("INVALID");
  }
};

/** Claims that authenticated and parsed, checked against their life and this artifact, in that order. */
const current = <Claims extends Readonly<{ artifact: string; at: number }>>(claims: Claims | null, artifactHash: string, at: number,
  ttl: number): Claims => {
  if (claims === null || at < claims.at) throw new DuelTokenRefusal("INVALID");
  if (at - claims.at > ttl) throw new DuelTokenRefusal("EXPIRED");
  if (claims.artifact !== artifactPrefix(artifactHash)) throw new DuelTokenRefusal("ROUND_SET");
  return claims;
};

export const sealChallenge = (claims: ChallengeClaims): string => {
  const parsed = parseChallenge(claims);
  if (parsed === null) throw new Error("DUEL_CHALLENGE_INVALID");
  return seal(CHALLENGE_CONTEXT, parsed);
};

/** A challenge this server issued for this artifact that is still live at `at`. */
export const openChallengeToken = (token: unknown, artifactHash: string, at: number): ChallengeClaims =>
  current(parseChallenge(open(CHALLENGE_CONTEXT, token)), artifactHash, at, CHALLENGE_TTL_MS);

export const sealResult = (claims: ResultClaims): string => {
  const parsed = parseResult(claims);
  if (parsed === null) throw new Error("DUEL_RESULT_INVALID");
  return seal(RESULT_CONTEXT, parsed);
};

/** A result this server issued for this artifact that is still live at `at`. */
export const openResultToken = (token: unknown, artifactHash: string, at: number): ResultClaims =>
  current(parseResult(open(RESULT_CONTEXT, token)), artifactHash, at, RESULT_TTL_MS);
