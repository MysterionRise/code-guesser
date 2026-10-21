import type { EntertainmentResultProjection, RoundRecord } from "./arcade-session";
import { ArcadeShellRuleError, type RoundModeKind } from "./mode-contract";

/** The words the game shows around a round: points, progress, hint costs, the share line, and pane notes. */

export const points = (value: number): string => value.toLocaleString("en-US");

/** The share grid's marks (#171): right with no hint, right with hints, and missed. */
export const SHARE_MARKS = Object.freeze({ clean: "🟩", hinted: "🟨", missed: "⬛" });

/** What the share line may know of a round: whether it was right, and whether it took hints. */
export type SharedRound = Pick<RoundRecord, "correct" | "hints">;

const shareMark = ({ correct, hints }: SharedRound): string => !correct ? SHARE_MARKS.missed : hints === 0 ? SHARE_MARKS.clean : SHARE_MARKS.hinted;

const SHARE_URL = /^https?:\/\/\S+$/u;

/**
 * The share line (#171): the deck, the tally, one mark per round in play order, and the game's own address, so a
 * friend can play the same five. It reads only each round's outcome and hint count, never a round's content or answer.
 */
export function projectSpoilerFreeShare(result: EntertainmentResultProjection, rounds: readonly SharedRound[], deckTitle?: string, url?: string) {
  if (result.completedRounds !== 5) throw new ArcadeShellRuleError("sharing requires a complete run");
  if (rounds.length !== result.completedRounds) throw new ArcadeShellRuleError("sharing needs every round's outcome");
  if (url !== undefined && !SHARE_URL.test(url)) throw new ArcadeShellRuleError("a shared link must be an absolute web address");
  const correct = rounds.filter((round) => round.correct).length;
  const tally = ["CodeGuessr", ...(deckTitle ? [deckTitle] : []),
    `${correct}/${result.completedRounds}`, `${points(result.score)}/${points(result.attainableMaximum)}`].join(" · ");
  const message = `${tally}\n${rounds.map(shareMark).join("")}`;
  return Object.freeze({
    /** The whole line, link included, as the clipboard takes it. */
    text: url === undefined ? message : `${message}\n${url}`,
    /** The line without its link, for a share sheet that takes the link on its own. */
    message,
    url: url ?? null,
    score: result.score,
    rounds: result.completedRounds,
    correct,
  });
}

export function formatCompletionResult(result: EntertainmentResultProjection, correctRounds: number): string {
  if (!Number.isInteger(correctRounds) || correctRounds < 0 || correctRounds > result.completedRounds) {
    throw new ArcadeShellRuleError("correct rounds must be within the completed rounds");
  }
  return `Run complete — ${points(result.score)} points, ${correctRounds} of ${result.completedRounds} correct.`;
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
  "missing-line": "One line is hidden; pick the line that fills the gap.",
  "name-function": "The function's name is hidden as mystery; pick the name its author gave it.",
  framework: "Every framework's name is hidden as mystery; the app is the same in each.",
  exercise: "Every exercise's name is hidden as mystery; pick the exercise this solves.",
  "vulnerable-line": "Lines are numbered; each option names one.",
});

/** What the player sees when the server can no longer continue this game, for example after it restarts. */
export const SESSION_ENDED_MESSAGE = "This game can’t continue. Deal new rounds to keep playing.";

/** What the player sees when a hint or an answer came too fast for the server's rate limit (#98); the game goes on. */
export const RATE_LIMITED_MESSAGE = "That was too many requests at once. Wait a few seconds, then try again.";
