/**
 * Duels (#173): what a challenge link and its result show, as the server sends them to the browser. A challenge holds
 * how each round went and nothing that tells a round's answer: no round, option, or player is named.
 */

/** One round as a player played it: right (1) or not (0), the hints bought, and the points it scored. */
export type DuelRound = readonly [correct: 0 | 1, hints: 0 | 1 | 2, points: number];

/**
 * Whether the challenger's game was the first of its deal to reveal a round on this server (`yes`), or followed an
 * earlier one (`no`); today's five is everyone's game, so it is `shared`.
 */
export type FirstPlay = "yes" | "no" | "shared";

/** One side of a duel: its rounds, and their totals. */
export interface DuelSide {
  readonly rounds: readonly DuelRound[];
  readonly score: number;
  readonly hints: number;
  readonly correct: number;
}

/** What a challenge link shows before the friend plays: the deck, and how the challenger did. */
export interface ChallengeView {
  readonly deck: string;
  readonly deckTitle: string;
  /** Today's five's date, for a challenge on it; null otherwise. */
  readonly date: string | null;
  /** The game's best possible score. */
  readonly max: number;
  readonly challenger: DuelSide & Readonly<{ firstPlay: FirstPlay }>;
  /** When the link stops dealing, in ms. */
  readonly expiresAt: number;
}

/**
 * The duel's winner: the higher score, then fewer hints, then more rounds right; level on all three is a draw. Each
 * reader recomputes it from the rounds, and never takes it from a link.
 */
export interface DuelVerdict {
  readonly winner: "challenger" | "challenged" | null;
  readonly decidedBy: "score" | "hints" | "correct" | "draw";
}

/** Both games of a duel side by side, as its result link shows them. */
export interface DuelComparison {
  readonly deck: string;
  readonly deckTitle: string;
  readonly date: string | null;
  readonly max: number;
  readonly challenger: DuelSide & Readonly<{ firstPlay: FirstPlay }>;
  /** The friend's game, and which play of the link it was, from 1. */
  readonly challenged: DuelSide & Readonly<{ play: number }>;
  readonly verdict: DuelVerdict;
}

/**
 * Why the server would not act on a duel: a link it didn't issue or can't read (`INVALID`), one past its life
 * (`EXPIRED`), one for an earlier round set (`ROUND_SET`), a re-deal that no longer matches the challenger's game
 * (`DEAL_DRIFT`), a game that can't challenge or answer this challenge (`NOT_ELIGIBLE`), or a game that has ended.
 */
export type DuelRefusalReason = "INVALID" | "EXPIRED" | "ROUND_SET" | "DEAL_DRIFT" | "NOT_ELIGIBLE" | "SESSION_ENDED";
export type DuelRefusal = Readonly<{ ok: false; reason: DuelRefusalReason }>;

/**
 * A challenge for a finished game: its link's token, and what the link shows. `firstIssue` is false when the game
 * already had one; it is the same challenge.
 */
export type CreateChallengeResponse = Readonly<{ ok: true; challengeToken: string; challenge: ChallengeView; firstIssue: boolean }> | DuelRefusal;
export type OpenChallengeResponse = Readonly<{ ok: true; challenge: ChallengeView }> | DuelRefusal;
/** The friend's finished game against the challenge: the result link's token, and the comparison it shows. */
export type IssueResultResponse = Readonly<{ ok: true; resultToken: string; comparison: DuelComparison }> | DuelRefusal;
export type OpenResultResponse = Readonly<{ ok: true; comparison: DuelComparison }> | DuelRefusal;

export interface IssueResultRequest {
  sessionToken: string;
  challengeToken: string;
}

/** A side's totals over its rounds. */
export const duelSide = (rounds: readonly DuelRound[]): DuelSide => Object.freeze({
  rounds,
  score: rounds.reduce((total, [, , points]) => total + points, 0),
  hints: rounds.reduce((total, [, hints]) => total + hints, 0),
  correct: rounds.reduce((total, [correct]) => total + correct, 0),
});

/** Decides a duel on the higher score, then fewer hints, then more rounds right; otherwise it is a draw. */
export const duelVerdict = (challenger: readonly DuelRound[], challenged: readonly DuelRound[]): DuelVerdict => {
  const [a, b] = [duelSide(challenger), duelSide(challenged)];
  // Each test is the challenger's lead; the first that isn't level decides.
  const tests = [["score", a.score - b.score], ["hints", b.hints - a.hints], ["correct", a.correct - b.correct]] as const;
  const decisive = tests.find(([, lead]) => lead !== 0);
  return Object.freeze(decisive === undefined ? { winner: null, decidedBy: "draw" }
    : { winner: decisive[1] > 0 ? "challenger" : "challenged", decidedBy: decisive[0] });
};
