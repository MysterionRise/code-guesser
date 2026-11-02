import type { EntertainmentResultProjection, RoundRecord } from "./arcade-session";
import type { RecordDelta } from "./local-records";
import { ArcadeShellRuleError, type RoundModeKind } from "./mode-contract";

/** The words the game shows around a round: points, progress, hint costs, the share line, and pane notes. */

export const points = (value: number): string => value.toLocaleString("en-US");

/** The share grid's marks (#171): right with no hint, right with hints, and missed. */
export const SHARE_MARKS = Object.freeze({ clean: "🟩", hinted: "🟨", missed: "⬛" });

/** What the share line may know of a round: whether it was right, and whether it took hints. */
export type SharedRound = Pick<RoundRecord, "correct" | "hints">;

export const shareMark = ({ correct, hints }: SharedRound): string => !correct ? SHARE_MARKS.missed : hints === 0 ? SHARE_MARKS.clean : SHARE_MARKS.hinted;

export const SHARE_URL = /^https?:\/\/\S+$/u;

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
  return `Run complete: ${points(result.score)} points, ${correctRounds} of ${result.completedRounds} correct.`;
}

/**
 * The verdicts a reveal opens with: one pool per outcome, and one line each for a game that ends with every round right
 * or none. A round's verdict is chosen by its id, so every player sees the same words on the same round, and a game's
 * five rounds read differently.
 */
export const VERDICTS = Object.freeze({
  /** Right, with no hint. */
  clean: Object.freeze(["Nice read.", "Clean read.", "Called it.", "Spot on.", "Straight to it."]),
  /** Right, after a hint or two. */
  hinted: Object.freeze(["Nice read.", "Hint well spent.", "Got there.", "Narrowed it down."]),
  missed: Object.freeze(["Not this time.", "Not that one.", "A fair miss.", "Tricky one.", "Missed it."]),
  /** The last round of a game with every round right. */
  sweep: Object.freeze(["Clean sweep."]),
  /** The last round of a game with none right. */
  blank: Object.freeze(["Rough deal."]),
});

/** FNV-1a over the text, 32 bits: a fixed, cheap way to pick by round id, the same in every browser. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/**
 * The verdict a round's reveal opens with (`VERDICTS`), by its outcome and, on the last round, the game's. A phrase the
 * game has shown already (`used`, #234) is passed over for the pool's next, so no verdict reads twice in five rounds
 * while every pool has words left; the choice still starts from the round id, so every player reads the same words.
 */
export const verdictText = ({ roundId, correct, hintsUsed, complete, correctRounds, completedRounds, used }: Readonly<{
  roundId: string; correct: boolean; hintsUsed: number; complete: boolean; correctRounds: number; completedRounds: number;
  used?: ReadonlySet<string>;
}>): string => {
  const pool = complete && correctRounds === completedRounds ? VERDICTS.sweep
    : complete && correctRounds === 0 ? VERDICTS.blank
      : !correct ? VERDICTS.missed : hintsUsed === 0 ? VERDICTS.clean : VERDICTS.hinted;
  const start = fnv1a(roundId) % pool.length;
  for (let offset = 0; offset < pool.length; offset += 1) {
    const text = pool[(start + offset) % pool.length]!;
    if (used === undefined || !used.has(text)) return text;
  }
  return pool[start]!;
};

/** The verdicts a game's earlier rounds opened with, in order, so the next round's can avoid them. */
export const priorVerdicts = (rounds: readonly Pick<RoundRecord, "roundId" | "correct" | "hints">[]): ReadonlySet<string> => {
  const used = new Set<string>();
  for (const { roundId, correct, hints } of rounds) {
    used.add(verdictText({ roundId, correct, hintsUsed: hints, complete: false, correctRounds: 0, completedRounds: 0, used }));
  }
  return used;
};

const alternation = (pools: readonly (readonly string[])[]): string =>
  [...new Set(pools.flat())].map((text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
/** Matches a whole verdict heading, whichever words the round drew: for tests and the demo recorder. */
export const VERDICT_PATTERN = Object.freeze({
  right: new RegExp(`^(?:${alternation([VERDICTS.clean, VERDICTS.hinted, VERDICTS.sweep])})$`, "u"),
  missed: new RegExp(`^(?:${alternation([VERDICTS.missed, VERDICTS.blank])})$`, "u"),
  any: new RegExp(`^(?:${alternation([VERDICTS.clean, VERDICTS.hinted, VERDICTS.sweep, VERDICTS.missed, VERDICTS.blank])})$`, "u"),
});

/** What one round earned and the hints it took, as its reveal states it: "+800 points (1 hint)" or "0 points (no hints)". */
export const roundPointsNote = (score: number, hintsUsed: number): string =>
  `${score > 0 ? "+" : ""}${points(score)} points (${hintsUsed === 0 ? "no hints" : hintsUsed === 1 ? "1 hint" : `${hintsUsed} hints`})`;

/**
 * What a finished game did to the player's records (#63), under its result: "New best 4,300, up from 3,800 · Streak 3
 * games, your longest · Day streak 2". Null when there is nothing to say: no new best, no streak of two, and no day
 * streak, or a game that counted for nothing.
 */
export const recordLine = (delta: RecordDelta): string | null => {
  if (!delta.counted) return null;
  const parts = [
    ...(delta.newBest === null ? [] : [`New best ${points(delta.newBest.score)}${delta.newBest.previous > 0 ? `, up from ${points(delta.newBest.previous)}` : ""}`]),
    ...(delta.streak >= 2 ? [`Streak ${delta.streak} games${delta.bestStreak ? ", your longest" : ""}`] : []),
    ...(delta.dayStreak === null ? [] : [`Day streak ${delta.dayStreak}`]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
};

/** How the round track names one round to assistive technology: "Round 2, current" or "Round 1, correct". */
export const roundStatusText = (round: number, current: boolean, correct: boolean | undefined): string =>
  [`Round ${round}`, ...(current ? ["current"] : []), ...(correct === undefined ? [] : [correct ? "correct" : "missed"])].join(", ");

/**
 * The button that buys the next hint, with what it costs this round (#239): "Reveal hint 1 (−200)". `values` are the
 * round's points after zero, one, and two hints; `order` is the hint's number, from one.
 */
export const hintButtonLabel = (order: number, values: readonly number[]): string => {
  const before = values[order - 1];
  const after = values[order];
  if (before === undefined || after === undefined || after > before) throw new ArcadeShellRuleError("a hint's cost needs the points before and after it");
  return `Reveal hint ${order} (−${points(before - after)})`;
};

/**
 * What a single pane shows, where a deck's code needs a word the prompt does not say (#239); comparison panes name
 * their version.
 */
export const PANE_CAPTIONS: Readonly<Partial<Record<RoundModeKind, string>>> = Object.freeze({
  algorithm: "Its own names, and any option's name, are hidden as mystery.",
  output: "The last line is a call typed into a Python shell.",
  fix: "Lines are numbered; each option names one.",
  "missing-line": "One line is hidden.",
  "name-function": "The function's name is hidden as mystery.",
  framework: "Every framework's name is hidden as mystery; the app is the same in each.",
  exercise: "Every exercise's name is hidden as mystery.",
  "vulnerable-line": "Lines are numbered; each option names one.",
});

/** What the player sees when the server can no longer continue this game, for example after it restarts. */
export const SESSION_ENDED_MESSAGE = "This game can’t continue. Deal new rounds to keep playing.";

/**
 * What the player sees when the game was redeployed since the page loaded (#170). Each build names its server actions
 * afresh, so an older page's hint, answer, or link asks for an action the new server doesn't know; a reload fetches the
 * new page.
 */
export const UPDATED_MESSAGE = "CodeGuessr was updated. Reload the page to keep playing.";

/** What the player sees when a hint or an answer came too fast for the server's rate limit (#98); the game goes on. */
export const RATE_LIMITED_MESSAGE = "That was too many requests at once. Wait a few seconds, then try again.";
