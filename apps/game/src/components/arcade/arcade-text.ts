import type { EntertainmentResultProjection } from "./arcade-session";
import { ArcadeShellRuleError, type RoundModeKind } from "./mode-contract";

/** The words the game shows around a round: points, progress, hint costs, the share line, and pane notes. */

export const points = (value: number): string => value.toLocaleString("en-US");

/** The share line names the deck and the tally, never a round's content or answer. */
export function projectSpoilerFreeShare(result: EntertainmentResultProjection, correctRounds: number, deckTitle?: string) {
  if (result.completedRounds !== 5) throw new ArcadeShellRuleError("sharing requires a complete run");
  if (!Number.isInteger(correctRounds) || correctRounds < 0 || correctRounds > result.completedRounds) {
    throw new ArcadeShellRuleError("correct rounds must be within the completed rounds");
  }
  const parts = ["CodeGuessr", ...(deckTitle ? [deckTitle] : []),
    `${correctRounds}/${result.completedRounds} correct`, `${points(result.score)}/${points(result.attainableMaximum)}`];
  return Object.freeze({
    text: parts.join(" · "),
    score: result.score,
    rounds: result.completedRounds,
    correct: correctRounds,
  });
}

export function formatCompletionResult(result: EntertainmentResultProjection, correctRounds: number, deckTitle?: string): string {
  const share = projectSpoilerFreeShare(result, correctRounds, deckTitle);
  return `Run complete — ${points(result.score)} points, ${correctRounds} of ${result.completedRounds} correct. Share: ${share.text}.`;
}

/** What one round earned and the hints it took, as its reveal states it: "+800 points (1 hint)" or "0 points (no hints)". */
export const roundPointsNote = (score: number, hintsUsed: number): string =>
  `${score > 0 ? "+" : ""}${points(score)} points (${hintsUsed === 0 ? "no hints" : hintsUsed === 1 ? "1 hint" : `${hintsUsed} hints`})`;

/** How the round track names one round to assistive technology: "Round 2, current" or "Round 1, correct". */
export const roundStatusText = (round: number, current: boolean, correct: boolean | undefined): string =>
  [`Round ${round}`, ...(current ? ["current"] : []), ...(correct === undefined ? [] : [correct ? "correct" : "missed"])].join(", ");

/** The round's own points after zero, one, and two hints. */
export const hintCostNote = (values: readonly number[]): string =>
  `Each hint lowers this round’s points: ${values.map(points).join(" → ")}.`;

/** What a single pane shows, where a deck's code needs a word of explanation; comparison panes name their version. */
export const PANE_CAPTIONS: Readonly<Partial<Record<RoundModeKind, string>>> = Object.freeze({
  algorithm: "Its own names, and any option's name, are hidden as mystery.",
  output: "The last line is a call typed into a Python shell.",
  fix: "Lines are numbered; each option names one.",
});

/** What the player sees when the server can no longer continue this game, for example after it restarts. */
export const SESSION_ENDED_MESSAGE = "This game can’t continue. Deal new rounds to keep playing.";
