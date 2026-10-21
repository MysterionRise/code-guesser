import { SHARE_URL, points, shareMark } from "../arcade/arcade-text";
import { ArcadeShellRuleError } from "../arcade/mode-contract";
import type { ChallengeView, DuelComparison, DuelRound, DuelSide, DuelVerdict, FirstPlay } from "./duel-contract";

/**
 * The words a duel shows (#173): its players' names, how each round and each side went, the verdict, and the share
 * lines. Names live only in a link's fragment, so the server never reads them; each is cleaned here before it shows.
 */

/** Who a challenge names when its link carries no name, or none fit to show. */
export const DEFAULT_NAME = "A friend";
/** Who a result names when its link carries no names: the player who challenged, and the friend who answered. */
export const RESULT_NAMES = Object.freeze({ challenger: "Challenger", challenged: "Friend" });
/** The most code points a name keeps. */
export const NAME_LIMIT = 24;

/**
 * A name as a player typed it or a link's fragment carries it: NFKC, with control and format characters dropped (bidi
 * overrides, zero-width joiners), curly apostrophes made straight, and runs of spaces made one. What is left must be
 * letters, marks, digits, spaces, `-`, `'`, and `_`, at most 24 code points; anything else is the fallback.
 */
export const sanitizeName = (value: unknown, fallback: string = DEFAULT_NAME): string => {
  if (typeof value !== "string") return fallback;
  const name = value.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[\u2018\u2019]/gu, "'").replace(/\s+/gu, " ").trim();
  return name.length > 0 && [...name].length <= NAME_LIMIT && /^[\p{L}\p{M}\p{N} '_-]+$/u.test(name) ? name : fallback;
};

/** The names a duel link's fragment carries: the challenger's (`from`), and on a result the friend's (`vs`). */
export interface FragmentNames {
  readonly from: string | null;
  readonly vs: string | null;
}

const named = (value: string | null): string | null => {
  const name = sanitizeName(value, "");
  return name === "" ? null : name;
};

/** The names in a fragment such as `#from=Ana&vs=Ben`; a name missing or unfit to show is null. */
export const fragmentNames = (hash: string): FragmentNames => {
  const query = new URLSearchParams(hash.replace(/^#/u, ""));
  return Object.freeze({ from: named(query.get("from")), vs: named(query.get("vs")) });
};

/** A fragment for these names, cleaned, or nothing when there is none to carry. */
export const nameFragment = (names: Partial<FragmentNames>): string => {
  const query = new URLSearchParams((["from", "vs"] as const).flatMap((key) => {
    const name = named(names[key] ?? null);
    return name === null ? [] : [[key, name]];
  })).toString();
  return query === "" ? "" : `#${query}`;
};

export const hintWords = (hints: number): string => hints === 0 ? "no hints" : hints === 1 ? "1 hint" : `${hints} hints`;

/** One round as a player played it: "right, 1 hint, +800 points" or "missed, no hints, 0 points". */
export const roundWords = ([correct, hints, scored]: DuelRound): string =>
  `${correct ? "right" : "missed"}, ${hintWords(hints)}, ${scored > 0 ? "+" : ""}${points(scored)} points`;

/** The challenger's round, as the friend's reveal states it once they have locked theirs: "Ana: right, 1 hint, +800 points." */
export const opponentRoundLine = (name: string, round: DuelRound): string => `${name}: ${roundWords(round)}.`;

/** How a side did in all, over a game's five rounds: "3/5 right · 3,300 of 5,000". */
export const sideLine = ({ correct, score }: Pick<DuelSide, "correct" | "score">, max: number): string =>
  `${correct}/5 right · ${points(score)} of ${points(max)}`;

/**
 * Whether the challenger had played the deal before: "First try" ("First try for Ana" where both players show), "Ana
 * had played these rounds before", or nothing for today's five, which everyone plays.
 */
export const firstPlayNote = (firstPlay: FirstPlay, name: string, whose = false): string | null =>
  firstPlay === "shared" ? null : firstPlay === "no" ? `${name} had played these rounds before` : whose ? `First try for ${name}` : "First try";

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, … 21st. */
export const ordinal = (value: number): string => {
  const tens = value % 100;
  return `${value}${tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
};

/** Which play of the link a friend's game was, after their first: "Ben's 2nd play of this link", or in their own game "Your 2nd". */
export const playNote = (play: number, name: string | null): string | null =>
  play <= 1 ? null : `${name === null ? "Your" : `${name}’s`} ${ordinal(play)} play of this link`;

/** A duel's deck as its link names it; today's five names its date: "Today’s five of 2026-10-21". */
export const duelDeckTitle = ({ deckTitle, date }: Pick<ChallengeView, "deckTitle" | "date">): string =>
  date === null ? deckTitle : `${deckTitle} of ${date}`;

/** Who a comparison names: the challenger, and the friend, who is "you" in their own game (null). */
export interface DuelNames {
  readonly challenger: string;
  readonly challenged: string | null;
}

/** A side's name as a comparison shows it. */
export const sideName = (names: DuelNames, side: "challenger" | "challenged"): string =>
  side === "challenger" ? names.challenger : names.challenged ?? "You";

const wins = (names: DuelNames, side: "challenger" | "challenged"): string =>
  side === "challenged" && names.challenged === null ? "You win" : `${sideName(names, side)} wins`;

const TIE_BREAKS: Readonly<Record<DuelVerdict["decidedBy"], string | null>> = Object.freeze({
  score: null,
  hints: "Level on points, so fewer hints decided it.",
  correct: "Level on points and hints, so more rounds right decided it.",
  draw: "Level on points, hints, and rounds right.",
});

/**
 * A verdict in words: "You win by 500 points", "Ana wins by 500 points", "Ana wins", or "A draw"; and when the points
 * were level, the line that says what decided it.
 */
export const verdictWords = ({ verdict, challenger, challenged }: Pick<DuelComparison, "verdict" | "challenger" | "challenged">,
  names: DuelNames): Readonly<{ heading: string; tieBreak: string | null }> => Object.freeze({
  heading: verdict.winner === null ? "A draw"
    : verdict.decidedBy === "score" ? `${wins(names, verdict.winner)} by ${points(Math.abs(challenger.score - challenged.score))} points`
      : wins(names, verdict.winner),
  tieBreak: TIE_BREAKS[verdict.decidedBy],
});

const grid = (rounds: readonly DuelRound[]): string => rounds.map(([correct, hints]) => shareMark({ correct: correct === 1, hints })).join("");

/** A share line, as the clipboard takes it, and as a share sheet takes it with its link apart. */
export interface DuelShare {
  readonly text: string;
  readonly message: string;
  readonly url: string;
}

const shared = (message: string, url: string): DuelShare => {
  if (!SHARE_URL.test(url)) throw new ArcadeShellRuleError("a shared link must be an absolute web address");
  return Object.freeze({ text: `${message}\n${url}`, message, url });
};

/**
 * A challenge's share line: the deck and the challenger's total, so a friend knows what to beat, and the link. It has
 * no grid: the challenger's rounds stay hidden until the friend has answered each one.
 */
export const challengeShare = (challenge: Pick<ChallengeView, "deckTitle" | "date" | "max" | "challenger">, name: string | null,
  url: string): DuelShare =>
  shared(`CodeGuessr duel · ${duelDeckTitle(challenge)} · ${name ?? "I"} scored ${points(challenge.challenger.score)}/${points(challenge.max)}. `
    + "Can you beat it?", url);

/**
 * A result's share line: the deck and the verdict, then each side's grid and total, the friend's first, and the link.
 * Like the game's own share line (#171), it reads only whether each round was right and took hints.
 */
export const resultShare = (comparison: DuelComparison, names: Readonly<{ challenger: string; challenged: string }>, url: string): DuelShare => {
  const { heading } = verdictWords(comparison, names);
  const line = ({ rounds, score }: DuelSide, name: string) => `${name} ${grid(rounds)} ${points(score)}/${points(comparison.max)}`;
  return shared([`CodeGuessr duel · ${duelDeckTitle(comparison)} · ${heading}`, line(comparison.challenged, names.challenged),
    line(comparison.challenger, names.challenger)].join("\n"), url);
};
