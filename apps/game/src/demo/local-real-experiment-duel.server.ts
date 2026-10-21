import "server-only";

import type { PublicModeContract } from "../components/arcade/mode-contract";
import {
  duelSide,
  duelVerdict,
  type ChallengeView,
  type CreateChallengeResponse,
  type DuelComparison,
  type DuelRefusal,
  type DuelRefusalReason,
  type DuelRound,
  type IssueResultResponse,
  type OpenChallengeResponse,
  type OpenResultResponse,
} from "../components/duel/duel-contract";
import { challengedArms, parseDisabled, type AssignOptions } from "../experiment/arms";
import { gameSources } from "./game-sources.server";
import type { DealDescriptor } from "./local-real-experiment-deal.server";
import { ROUNDS_PER_SESSION, type SessionDeckId } from "./local-real-experiment-domain.server";
import {
  CHALLENGE_TTL_MS,
  DuelTokenRefusal,
  artifactPrefix,
  challengeId,
  openChallengeToken,
  openResultToken,
  sealChallenge,
  sealResult,
  type ChallengeClaims,
  type ResultClaims,
} from "./local-real-experiment-duel-token.server";
import { markIssued } from "./local-real-experiment-plays.server";
import type { DerivedRound } from "./local-real-experiment-rounds.server";
import { SessionRefusal, readGame, type GameState } from "./local-real-experiment-session.server";
import type { DealSeal, DealtGame, LocalRealDeck, LocalRealMix } from "./local-real-experiment.server";

/**
 * Duels (#173): a finished game of a seeded deal or of today's five becomes a challenge link; a friend who opens it is
 * dealt the same game under the same arms, and their finished game becomes a result link that shows both. Links are
 * sealed (`local-real-experiment-duel-token.server.ts`), and the server re-deals and checks every challenge before
 * dealing it, so neither player's browser can change what the other sees.
 */

export type DealChallengeResponse = Readonly<{ ok: true; game: DealtGame; challenge: ChallengeView }> | DuelRefusal;

/** Whether generative UI is on and which levels are switched off, which decide the friend's design. */
export type ArmSwitches = Pick<AssignOptions, "genuiEnabled" | "disabled">;

export interface DuelAuthority {
  /** A challenge link for a finished game of a seeded deal or of today's five; the same challenge each time it's asked. */
  readonly createChallenge: (sessionToken: unknown, now?: number) => CreateChallengeResponse;
  /** What a challenge link shows before it deals anything. */
  readonly openChallenge: (challengeToken: unknown, now?: number) => OpenChallengeResponse;
  /** Deals the friend the challenger's game, once the re-deal matches it to the digit, under the challenger's arms. */
  readonly dealChallenge: (challengeToken: unknown, now?: number, record?: boolean, switches?: ArmSwitches) => DealChallengeResponse;
  /** A result link for the friend's finished game of this challenge. */
  readonly issueResult: (sessionToken: unknown, challengeToken: unknown, now?: number) => IssueResultResponse;
  /** What a result link shows, with the verdict worked out again. */
  readonly openResult: (resultToken: unknown, now?: number) => OpenResultResponse;
}

/** What the duels need of the experiment: its rounds and the way it deals, seals, and digests a game. */
export interface DuelContext {
  readonly artifactHash: string;
  readonly decks: readonly LocalRealDeck[];
  readonly mixed: LocalRealMix | null;
  readonly rounds: ReadonlyMap<string, DerivedRound>;
  /** Deals a seeded deal's game or today's five as `dealGame` does. */
  readonly deal: (deckId: SessionDeckId, descriptor: DealDescriptor) => Readonly<{ mode: PublicModeContract; wrapped: boolean }>;
  /** Seals a dealt game, as `dealGame` does. */
  readonly start: (deckId: SessionDeckId, dealt: Readonly<{ mode: PublicModeContract; wrapped: boolean }>, now: number, seal: DealSeal,
    descriptor: DealDescriptor) => DealtGame;
  readonly digestOf: (mode: PublicModeContract, arms: DealSeal["arms"]) => string;
  readonly maximumOf: (roundIds: readonly string[]) => number;
}

/** Duel games record no events until events v2 (X3 of #173) can tell them from a deal's. */
const DUEL_EVENTS = false;

const refusal = (reason: DuelRefusalReason): DuelRefusal => Object.freeze({ ok: false, reason });

/** A refusal the browser may learn: the token's or the game's reason, and `INVALID` for anything else. */
const refusalFor = (error: unknown): DuelRefusal =>
  error instanceof DuelTokenRefusal ? refusal(error.reason)
    : error instanceof SessionRefusal ? refusal(error.reason === "SESSION_ENDED" ? "SESSION_ENDED" : "NOT_ELIGIBLE")
      : refusal("INVALID");

/** The switches as this server is configured. */
const configuredSwitches = (): ArmSwitches =>
  ({ genuiEnabled: process.env.GENUI_ENABLED === "1", disabled: parseDisabled(process.env.EXPERIMENT_DISABLED) });

export const duelAuthority = (context: DuelContext): DuelAuthority => {
  const { artifactHash, rounds } = context;
  const titles = new Map(gameSources(context).map(({ id, title }) => [id, title] as const));
  // A link names a deck this artifact offers; one it doesn't was made for another round set.
  const titleOf = (deck: SessionDeckId): string => {
    const title = titles.get(deck);
    if (title === undefined) throw new DuelTokenRefusal("ROUND_SET");
    return title;
  };

  /** A finished game's rounds as a duel shows them, scored from the server's own copy of each round. */
  const roundsOf = (state: GameState): readonly DuelRound[] => Object.freeze(state.roundIds.map((roundId, index) => {
    const correct = state.outcomes[index]!;
    const hints = state.hintsByRound[index]! as 0 | 1 | 2;
    return Object.freeze([correct ? 1 : 0, hints, correct ? rounds.get(roundId)!.publicRound.points[hints] : 0] as const);
  }));

  const challengeView = (claims: ChallengeClaims): ChallengeView => Object.freeze({
    deck: claims.deck,
    deckTitle: titleOf(claims.deck),
    date: claims.deal.kind === "daily" ? claims.deal.date : null,
    max: claims.max,
    challenger: Object.freeze({ ...duelSide(claims.rounds), firstPlay: claims.firstPlay }),
    expiresAt: claims.at + CHALLENGE_TTL_MS,
  });

  const comparison = (claims: ResultClaims): DuelComparison => Object.freeze({
    deck: claims.deck,
    deckTitle: titleOf(claims.deck),
    date: claims.date,
    max: claims.max,
    challenger: Object.freeze({ ...duelSide(claims.challenger.rounds), firstPlay: claims.challenger.firstPlay }),
    challenged: Object.freeze({ ...duelSide(claims.challenged.rounds), play: claims.challenged.play }),
    verdict: duelVerdict(claims.challenger.rounds, claims.challenged.rounds),
  });

  /** Whether a re-deal differs from the challenger's game: its digest, its best score, or what any round scored. */
  const drifted = (mode: PublicModeContract, claims: ChallengeClaims): boolean =>
    context.digestOf(mode, claims.arms) !== claims.digest
    || context.maximumOf(mode.rounds.map(({ roundId }) => roundId)) !== claims.max
    || claims.rounds.some(([correct, hints, points], index) => points !== (correct ? mode.rounds[index]!.points[hints] : 0));

  return {
    createChallenge: (sessionToken: unknown, now = Date.now()): CreateChallengeResponse => {
      try {
        const state = readGame(sessionToken, artifactHash, now);
        const { deal } = state;
        if (state.roundIndex < ROUNDS_PER_SESSION || (deal.kind !== "series" && deal.kind !== "daily")) return refusal("NOT_ELIGIBLE");
        const claims: ChallengeClaims = {
          v: 1, id: challengeId(state.gameId), artifact: artifactPrefix(artifactHash), deck: state.deck, deal, digest: state.dealDigest,
          arms: state.arms, rounds: roundsOf(state), max: context.maximumOf(state.roundIds),
          firstPlay: deal.kind === "daily" ? "shared" : state.priorPlays === 0 ? "yes" : "no", at: now,
        };
        const challengeToken = sealChallenge(claims);
        return Object.freeze({ ok: true, challengeToken, challenge: challengeView(claims), firstIssue: markIssued(claims.id, now) });
      } catch (error) {
        return refusalFor(error);
      }
    },
    openChallenge: (challengeToken: unknown, now = Date.now()): OpenChallengeResponse => {
      try {
        return Object.freeze({ ok: true, challenge: challengeView(openChallengeToken(challengeToken, artifactHash, now)) });
      } catch (error) {
        return refusalFor(error);
      }
    },
    dealChallenge: (challengeToken: unknown, now = Date.now(), record = true, switches = configuredSwitches()): DealChallengeResponse => {
      let claims: ChallengeClaims;
      let challenge: ChallengeView;
      try {
        claims = openChallengeToken(challengeToken, artifactHash, now);
        challenge = challengeView(claims);
      } catch (error) {
        return refusalFor(error);
      }
      let dealt: Readonly<{ mode: PublicModeContract; wrapped: boolean }> | null;
      try {
        dealt = context.deal(claims.deck, claims.deal);
      } catch {
        dealt = null;
      }
      // The link is fine but this server no longer deals its game: the code or the layers moved since. Only the code
      // is logged, never the link.
      if (dealt === null || drifted(dealt.mode, claims)) {
        console.error("DUEL_REFUSED DEAL_DRIFT");
        return refusal("DEAL_DRIFT");
      }
      const game = context.start(claims.deck, dealt, now, { arms: challengedArms(claims.arms, switches), record: DUEL_EVENTS && record },
        { kind: "duel", challenge: claims.id });
      return Object.freeze({ ok: true, game, challenge });
    },
    issueResult: (sessionToken: unknown, challengeToken: unknown, now = Date.now()): IssueResultResponse => {
      try {
        const state = readGame(sessionToken, artifactHash, now);
        // The friend's game answers the challenge it was dealt from, which was live when it was dealt.
        const claims = openChallengeToken(challengeToken, artifactHash, state.dealtAt);
        if (state.roundIndex < ROUNDS_PER_SESSION || state.deal.kind !== "duel" || state.deal.challenge !== claims.id
          || state.dealDigest !== claims.digest) return refusal("NOT_ELIGIBLE");
        const result: ResultClaims = {
          v: 1, id: claims.id, artifact: claims.artifact, deck: claims.deck, date: claims.deal.kind === "daily" ? claims.deal.date : null,
          max: claims.max, challenger: { rounds: claims.rounds, firstPlay: claims.firstPlay },
          challenged: { rounds: roundsOf(state), play: state.priorPlays + 1 }, at: now,
        };
        return Object.freeze({ ok: true, resultToken: sealResult(result), comparison: comparison(result) });
      } catch (error) {
        return refusalFor(error);
      }
    },
    openResult: (resultToken: unknown, now = Date.now()): OpenResultResponse => {
      try {
        return Object.freeze({ ok: true, comparison: comparison(openResultToken(resultToken, artifactHash, now)) });
      } catch (error) {
        return refusalFor(error);
      }
    },
  };
};
