import "server-only";

import type {
  AuthorizedReveal,
  GameRefusal,
  HintRequest,
  HintResponse,
  RevealRequest,
  RevealResponse,
} from "../components/arcade/arcade-session";
import { createPublicModeContract, type PublicModeContract } from "../components/arcade/mode-contract";
import { ARTIFACT_KEYS, parseArtifact } from "./local-real-experiment-artifact.server";
import {
  LocalRealExperimentError,
  ROUNDS_PER_SESSION,
  fail,
  DAILY_DECK,
  MIXED_DECK,
  type SessionDeckId,
  type PrivateReveal,
} from "./local-real-experiment-domain.server";
import {
  GAME_TTL_MS,
  SessionRefusal,
  advanceGame,
  newGameId,
  readGame,
  recordStep,
  sealGame,
  type GameState,
} from "./local-real-experiment-session.server";
import { CONTROL, type Arms } from "../experiment/arms";
import type { EventSink } from "../experiment/event-store.server";
import { elapsed, emitterFor, recordClientEvent, type ClientEventOutcome, type Emit } from "./local-real-experiment-events.server";
import { mixedRounds, seededRandom, seriesRounds, shuffle, type DealSeries } from "./local-real-experiment-deal.server";
import { roundHints, scaffoldOf, type PinnedArtifact, type RoundLayers } from "./local-real-experiment-layers.server";
import { dealFrom, deriveDecks, type DerivedRound, type LocalRealDeck } from "./local-real-experiment-rounds.server";
import type { RenderLimits } from "../genui/render-catalog";
import { roundContext, type RoundContext } from "../genui/round-context.server";
import {
  canonicalHash,
  deepFreeze,
  record,
  sha256,
} from "./local-real-experiment-validation.server";

export { LocalRealExperimentError };
export type { LocalRealDeck } from "./local-real-experiment-rounds.server";

/** The mixed game (#56), offered when the artifact holds at least a game's worth of decks. */
export interface LocalRealMix {
  readonly title: string;
  readonly description: string;
  readonly deckCount: number;
}

export interface LocalRealExperiment {
  readonly kind: "LOCAL_UNREVIEWED_EXPERIMENT";
  readonly artifactHash: string;
  readonly decks: readonly LocalRealDeck[];
  readonly mixed: LocalRealMix | null;
  readonly privateReveals: Readonly<Record<string, PrivateReveal>>;
  /**
   * Five rounds drawn at random from the deck's pool, or for the mix one round from each of five decks drawn at
   * random, each four-option round's options in a fresh order.
   */
  readonly dealSession: (deckId: SessionDeckId, random?: () => number, series?: DealSeries) => PublicModeContract;
  /**
   * A dealt session and the signed token that holds its progress, its arms, and whether it records events. A
   * `series` deals that game of a seeded deal (#40), the same on every load.
   */
  readonly dealGame: (deckId: SessionDeckId, random?: () => number, now?: number, seal?: DealSeal, series?: DealSeries) => DealtGame;
  /** The next hint of the round being played, which lowers what a right answer scores. */
  readonly revealHint: (request: HintRequest, now?: number) => HintResponse;
  /** Locks in one answer for the round being played and reveals it, scored from the server's own state. */
  readonly answer: (request: RevealRequest, now?: number) => RevealResponse;
  /**
   * What a model may learn about a round of this game (#102): the round being played before its answer is
   * locked, or any round already answered. Later rounds are refused.
   */
  readonly modelContext: (request: ModelContextRequest, now?: number) => ModelContextResponse;
  /**
   * Records one event only a browser sees (#107), for a game this server dealt and that has not expired. It names
   * a round already reached, and a game takes a bounded number of them.
   */
  readonly recordClientEvent: (request: unknown, now?: number) => ClientEventOutcome;
}

/** What a deal seals beside the rounds: the experiment arms (#106) and whether the game records events (#107). */
export interface DealSeal {
  readonly arms: Arms;
  readonly record: boolean;
}

/** One model call's outcome, as the genui route reports it for the event log. */
export interface ModelCallOutcome {
  readonly ok: boolean;
  /** The provider's HTTP status when the call failed with one; 0 otherwise. */
  readonly status: number;
  readonly calls: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly ms: number;
}

export interface ExperimentOptions {
  /** Where game events go; none records nothing. */
  readonly events?: EventSink | null;
  /**
   * Question layers by round id (#127), read once the artifact matches its pin, from the experiment's one parse and
   * hash of it (#166); a game shows them when its arms say so.
   */
  readonly layers?: (artifact: PinnedArtifact) => RoundLayers;
}

export type { ClientEventOutcome } from "./local-real-experiment-events.server";

export interface ModelContextRequest {
  readonly sessionToken: string;
  readonly roundId: string;
}

export type ModelContextResponse =
  | Readonly<{
    ok: true;
    context: RoundContext;
    limits: RenderLimits;
    /**
     * The round's code lines, for the server to refuse a player pasting the code into a chat before the lock.
     * Never part of the context, and never sent to a model or a browser.
     */
    codeLines: readonly string[];
    /** The game's sealed arms; the route serves only the design the game drew. */
    arms: Arms;
    /** The game's random id and when it expires, for the route's per-game caps (#98); never sent to a model. */
    game: Readonly<{ id: string; expiresAt: number }>;
    /** Records one model call for this round in the event log, when the game records events. */
    recordCall: (outcome: ModelCallOutcome, now?: number) => void;
  }>
  | GameRefusal;

export interface DealtGame {
  readonly mode: PublicModeContract;
  readonly sessionToken: string;
  /** The arms sealed into the token, so the page renders the game the experiment drew. */
  readonly arms: Arms;
  /** Whether this game of a seeded deal reached the end of its deck's pool, so its rounds start over (#40). */
  readonly wrapped: boolean;
}

const REJECTED: GameRefusal = Object.freeze({ ok: false, reason: "REJECTED" });
const SESSION_ENDED: GameRefusal = Object.freeze({ ok: false, reason: "SESSION_ENDED" });

/** A request's own fields, when it has exactly these and each is a non-empty string; anything else is refused. */
const strings = (value: unknown, keys: readonly string[]): Readonly<Record<string, string>> | null => {
  try {
    const request = record(value, keys);
    return keys.every((key) => typeof request[key] === "string" && (request[key] as string).length > 0)
      ? request as Record<string, string> : null;
  } catch {
    return null;
  }
};

/**
 * Runs one game transition and maps refusals to what the browser may learn: a token this server cannot continue
 * ends the session, and anything else that does not fit the game's state is rejected without detail.
 */
const transact = <Result>(
  token: string,
  artifactHash: string,
  now: number,
  transition: (state: GameState) => { next: GameState; result: Result },
): Readonly<{ ok: true; result: Result; sessionToken: string }> | GameRefusal => {
  try {
    const { result, token: sessionToken } = advanceGame(token, artifactHash, now, transition);
    return Object.freeze({ ok: true, result, sessionToken });
  } catch (error) {
    return refusalFor(error);
  }
};

const refusalFor = (error: unknown): GameRefusal =>
  error instanceof SessionRefusal && error.reason === "SESSION_ENDED" ? SESSION_ENDED : REJECTED;

/** The guard's context for one round of a game, from the server's own copy of the round. */
const contextFor = (round: DerivedRound, deckTitle: string, state: GameState, index: number, emit: Emit, layers: RoundLayers): ModelContextResponse => {
  const { publicRound, privateReveal } = round;
  // The hints this game sells for the round: a question layer's, when the game shows layers.
  const hints = roundHints(publicRound.roundId, round.hints, layers, state.arms.layer === "on").map(({ text }) => text);
  const phase = index < state.roundIndex ? "after-lock" : "before-lock";
  const context = roundContext({
    deck: deckTitle,
    prompt: publicRound.mode.prompt,
    options: publicRound.mode.candidates,
    points: publicRound.points,
    panes: publicRound.content.panes,
    hints,
    reveal: privateReveal,
  }, { round: index + 1, rounds: ROUNDS_PER_SESSION, score: state.score, hintsBought: phase === "before-lock" ? state.hints : state.hintsByRound[index] ?? 0, phase });
  return Object.freeze({
    ok: true,
    context,
    limits: Object.freeze({
      paneLineCounts: Object.freeze(publicRound.content.panes.map(({ text }) => text.split("\n").length)),
      optionLabels: Object.freeze(publicRound.mode.candidates.map(({ label }) => label)),
    }),
    codeLines: Object.freeze(publicRound.content.panes.flatMap(({ text }) => text.split("\n"))),
    arms: state.arms,
    game: Object.freeze({ id: state.gameId, expiresAt: state.dealtAt + GAME_TTL_MS }),
    recordCall: (outcome: ModelCallOutcome, now = Date.now()) => emit(state, "genui_call", { round: index + 1, phase, ...outcome }, now),
  });
};

/** The round being played, when the request names it; a finished game has none. */
const currentRound = (rounds: ReadonlyMap<string, DerivedRound>, state: GameState, roundId: string): DerivedRound => {
  if (state.roundIndex >= ROUNDS_PER_SESSION || state.roundIds[state.roundIndex] !== roundId) fail();
  return rounds.get(roundId) ?? fail();
};

const revealFor = (
  round: DerivedRound,
  state: GameState,
  candidateId: string,
  artifactHash: string,
  now: number,
  attainableMaximum: number,
): { next: GameState; result: AuthorizedReveal } => {
  const { publicRound, privateReveal: reveal } = round;
  if (!publicRound.mode.candidates.some((candidate) => candidate.candidateId === candidateId)) fail();
  const correct = candidateId === reveal.correctCandidateId;
  const roundScore = correct ? publicRound.points[state.hints] ?? fail() : 0;
  const next: GameState = {
    ...state, step: state.step + 1, roundIndex: state.roundIndex + 1, hints: 0, hintsByRound: [...state.hintsByRound, state.hints],
    correct: state.correct + (correct ? 1 : 0), score: state.score + roundScore, roundStartedAt: now,
  };
  return {
    next,
    result: deepFreeze({
      roundId: publicRound.roundId,
      roundVersionId: publicRound.roundVersionId,
      correct,
      answerCandidateId: reveal.correctCandidateId,
      score: roundScore,
      evidence: reveal.evidence,
      explanation: reveal.explanation,
      attribution: reveal.attribution,
      helpfulSignals: reveal.helpfulSignals,
      misleadingSignals: reveal.misleadingSignals,
      versions: reveal.versions,
      result: Object.freeze({
        score: next.score,
        attainableMaximum,
        completedRounds: next.roundIndex,
        resultVersionId: `local-experiment:${artifactHash}:round-${next.roundIndex}`,
      }),
    }),
  };
};

/** The pinned hash, when the artifact matches it; a pin that is not a hash, or an artifact that does not match it, is a hash mismatch. */
const pinnedHash = (artifactInput: unknown, trustedArtifactHash: string): string => {
  try {
    const expected = sha256(trustedArtifactHash);
    if (canonicalHash(artifactInput) === expected) return expected;
  } catch {
    // A malformed pin falls through to the mismatch.
  }
  return fail("HASH_MISMATCH");
};

export const createLocalRealExperiment = (
  artifactInput: unknown,
  trustedArtifactHash: string,
  options: ExperimentOptions = {},
): LocalRealExperiment => {
  const expectedArtifactHash = pinnedHash(artifactInput, trustedArtifactHash);
  const emit = emitterFor(options.events);
  // Anything an artifact that matches its pin then fails is the schema's.
  try {
    const artifact = record(artifactInput, ARTIFACT_KEYS);
    const parsed = parseArtifact(artifact);
    const decks = deriveDecks(parsed, artifact);
    const layers: RoundLayers = options.layers?.({ value: artifact, decks: parsed, hash: expectedArtifactHash }) ?? new Map();
    const privateReveals = deepFreeze(Object.fromEntries(decks.flatMap(({ rounds }) =>
      rounds.map(({ privateReveal }) => [privateReveal.roundId, privateReveal]))));
    if (Object.keys(privateReveals).length !== decks.reduce((total, { rounds }) => total + rounds.length, 0)) fail();
    const rounds = new Map(decks.flatMap((derived) => derived.rounds.map((round) => [round.publicRound.roundId, round] as const)));
    const deckTitles = new Map(decks.flatMap(({ deck, rounds: deckRounds }) => deckRounds.map(({ publicRound }) => [publicRound.roundId, deck.title] as const)));
    // A seeded deal's game takes its rounds from the seed's order of the pool, and its option order from the seed too.
    const deal = (deckId: SessionDeckId, random: () => number, series?: DealSeries) => {
      if (deckId === MIXED_DECK || deckId === DAILY_DECK) {
        const draw = series ? seededRandom({ ...series, deck: deckId }) : random;
        return { mode: decks.length < ROUNDS_PER_SESSION ? fail() : dealFrom(deckId, mixedRounds(decks, draw), artifact, draw), wrapped: false };
      }
      const derived = decks.find(({ deck }) => deck.id === deckId) ?? fail();
      if (!series) return { mode: dealFrom(deckId, shuffle(derived.rounds, random), artifact, random), wrapped: false };
      const { rounds: order, wrapped } = seriesRounds(derived.rounds, series.seed, deckId, series.game);
      return { mode: dealFrom(deckId, order, artifact, seededRandom({ ...series, deck: deckId, options: true })), wrapped };
    };
    const dealSession = (deckId: SessionDeckId, random: () => number = Math.random, series?: DealSeries) => deal(deckId, random, series).mode;
    // Each round scores up to its own top points, so a mixed game's best is the sum of its rounds'.
    const maximumOf = (state: GameState): number =>
      state.roundIds.reduce((total, roundId) => total + (rounds.get(roundId) ?? fail()).publicRound.points[0], 0);
    return Object.freeze({
      kind: "LOCAL_UNREVIEWED_EXPERIMENT",
      artifactHash: expectedArtifactHash,
      decks: Object.freeze(decks.map(({ deck }) => deck)),
      mixed: decks.length < ROUNDS_PER_SESSION ? null
        : Object.freeze({ title: "Mixed", description: "Five rounds, each from a different deck.", deckCount: decks.length }),
      privateReveals,
      dealSession,
      dealGame: (deckId: SessionDeckId, random: () => number = Math.random, now = Date.now(), seal: DealSeal = { arms: CONTROL, record: true },
        series?: DealSeries) => {
        const { mode: dealt, wrapped } = deal(deckId, random, series);
        // A game that shows question layers carries each layered round's scaffold with the round (#128).
        const mode = seal.arms.layer !== "on" || !dealt.rounds.some(({ roundId }) => layers.has(roundId)) ? dealt
          : createPublicModeContract({ sessionContractVersionId: dealt.sessionContractVersionId, rounds: dealt.rounds.map((round) => {
            const layer = layers.get(round.roundId);
            return { ...round, content: { ...round.content, panes: [...round.content.panes] },
              mode: { ...round.mode, candidates: [...round.mode.candidates], clues: [...round.mode.clues] },
              points: [...round.points] as [number, number, number], ...(layer ? { scaffold: scaffoldOf(layer) } : {}) };
          }) });
        const state: GameState = {
          version: 2, gameId: newGameId(), artifactHash: expectedArtifactHash, deck: deckId,
          roundIds: mode.rounds.map(({ roundId }) => roundId), step: 0, roundIndex: 0, hints: 0, hintsByRound: [], correct: 0, score: 0,
          dealtAt: now, roundStartedAt: now, arms: seal.arms, record: seal.record,
        };
        const sessionToken = sealGame(state);
        recordStep(state, now);
        emit(state, "game_dealt", {}, now);
        return Object.freeze({ mode, sessionToken, arms: state.arms, wrapped });
      },
      revealHint: (value: HintRequest, now = Date.now()): HintResponse => {
        const request = strings(value, ["sessionToken", "roundId"]);
        if (request === null) return REJECTED;
        let bought: GameState | undefined;
        const outcome = transact(request.sessionToken!, expectedArtifactHash, now, (state) => {
          const round = currentRound(rounds, state, request.roundId!);
          const hint = roundHints(round.publicRound.roundId, round.hints, layers, state.arms.layer === "on")[state.hints] ?? fail();
          bought = { ...state, step: state.step + 1, hints: state.hints + 1 };
          return { next: bought, result: hint };
        });
        if (!outcome.ok) return outcome;
        emit(bought!, "hint_revealed", { round: bought!.roundIndex + 1, hint: bought!.hints, ms: elapsed(bought!.roundStartedAt, now) }, now);
        const { text, detail } = outcome.result;
        return Object.freeze({ ok: true, hint: text, ...(detail ? { detail } : {}), sessionToken: outcome.sessionToken });
      },
      answer: (value: RevealRequest, now = Date.now()): RevealResponse => {
        const request = strings(value, ["sessionToken", "roundId", "candidateId"]);
        if (request === null) return REJECTED;
        let before: GameState | undefined;
        let after: GameState | undefined;
        const outcome = transact(request.sessionToken!, expectedArtifactHash, now, (state) => {
          before = state;
          const revealed = revealFor(currentRound(rounds, state, request.roundId!), state, request.candidateId!, expectedArtifactHash, now,
            maximumOf(state));
          after = revealed.next;
          return revealed;
        });
        if (!outcome.ok) return outcome;
        emit(after!, "round_revealed", { round: after!.roundIndex, correct: outcome.result.correct, hints: before!.hints,
          ms: elapsed(before!.roundStartedAt, now) }, now);
        if (after!.roundIndex === ROUNDS_PER_SESSION) {
          emit(after!, "game_completed", { score: after!.score, correct: after!.correct,
            hints: after!.hintsByRound.reduce((total, count) => total + count, 0), ms: elapsed(after!.dealtAt, now) }, now);
        }
        return Object.freeze({ ok: true, reveal: outcome.result, sessionToken: outcome.sessionToken });
      },
      modelContext: (value: ModelContextRequest, now = Date.now()): ModelContextResponse => {
        const request = strings(value, ["sessionToken", "roundId"]);
        if (request === null) return REJECTED;
        let state: GameState;
        try {
          state = readGame(request.sessionToken, expectedArtifactHash, now);
        } catch (error) {
          return refusalFor(error);
        }
        const index = state.roundIds.indexOf(request.roundId!);
        const round = rounds.get(request.roundId!);
        // The round being played, or one already answered; never a round still to come.
        if (index < 0 || index > state.roundIndex || round === undefined) return REJECTED;
        return contextFor(round, deckTitles.get(request.roundId!)!, state, index, emit, layers);
      },
      recordClientEvent: (value: unknown, now = Date.now()): ClientEventOutcome => recordClientEvent(value, expectedArtifactHash, now, emit),
    });
  } catch {
    return fail("SCHEMA");
  }
};
