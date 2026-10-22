import { readFileSync } from "node:fs";

import { FACTORS, type Factor } from "../../apps/game/src/experiment/arms";
import { isDay } from "../../apps/game/src/experiment/events";

/**
 * The experiment's change log (#169). The owner keeps shipping through the experiment rather than freezing the game,
 * so every player-visible change after launch day (the UI, the artifact, or the arms) is dated in `changes.json`, and
 * the report reads one period between changes at a time. An entry is dated by the UTC day it went live, the only time
 * an event records, so that day's games count in the period it starts.
 */

/** What a change may move: one factor's comparison, several, or `all` of them, such as a new artifact. */
export const CHANGE_FACTORS = Object.freeze([...Object.keys(FACTORS) as Factor[], "all"] as const);
export type ChangeFactor = (typeof CHANGE_FACTORS)[number];

export interface Change {
  readonly date: string;
  /** One line a reader of the report understands, at most `MAXIMUM_CHANGE_LENGTH` characters. */
  readonly change: string;
  readonly factors: readonly ChangeFactor[];
  /** The pull request that shipped it, when one did. */
  readonly pr?: number;
}

export const MAXIMUM_CHANGE_LENGTH = 200;
const KEYS = "change|date|factors";
const CONTROL_CHARACTER = /\p{Cc}/u;

const isFactors = (value: unknown): value is readonly ChangeFactor[] => Array.isArray(value) && value.length > 0
  && new Set(value).size === value.length && value.every((factor) => (CHANGE_FACTORS as readonly unknown[]).includes(factor))
  && (!value.includes("all") || value.length === 1);

/**
 * The log, when every entry fits: exact keys, a real day, one line of text, known factors (`all` alone), a positive
 * pull request number, and dates in order; otherwise null.
 */
export const parseChanges = (value: unknown): readonly Change[] | null => {
  if (!Array.isArray(value)) return null;
  const changes: Change[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const keys = Object.keys(entry).sort().join("|");
    if (keys !== KEYS && keys !== `${KEYS}|pr`) return null;
    const { date, change, factors, pr } = entry as Record<string, unknown>;
    if (!isDay(date) || date < (changes.at(-1)?.date ?? date)) return null;
    if (typeof change !== "string" || change.length === 0 || change.length > MAXIMUM_CHANGE_LENGTH || change.trim() !== change
      || CONTROL_CHARACTER.test(change)) return null;
    if (!isFactors(factors) || (pr !== undefined && !(Number.isSafeInteger(pr) && (pr as number) > 0))) return null;
    changes.push(Object.freeze({ date, change, factors: Object.freeze([...factors]), ...(pr === undefined ? {} : { pr: pr as number }) }));
  }
  return Object.freeze(changes);
};

/** The committed log, or null when it can't be read or doesn't parse. */
export const readChanges = (path: string): readonly Change[] | null => {
  try {
    return parseChanges(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return null;
  }
};

/** A stretch of days, both included. */
export interface Period {
  readonly from: string;
  readonly to: string;
}

const dayBefore = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The changes a window holds, both days included; with no first day, every change up to the last. */
export const changesWithin = (changes: readonly Change[], from: string | null, to: string): readonly Change[] =>
  Object.freeze(changes.filter(({ date }) => date <= to && (from === null || date >= from)));

/** The periods between changes in a window: each change after its first day starts one, which ends the day before the next. */
export const periodsOf = (changes: readonly Change[], from: string, to: string): readonly Period[] => {
  const starts = [from, ...new Set(changes.map(({ date }) => date).filter((date) => date > from && date <= to))];
  return Object.freeze(starts.map((start, index) => Object.freeze({ from: start, to: index + 1 < starts.length ? dayBefore(starts[index + 1]!) : to })));
};

/** Why `--period` was refused: not two real days in order, or a change falls inside it. */
export type PeriodRefusal = "PERIOD_MALFORMED" | "PERIOD_SPANS_CHANGE";

/**
 * `--period=<from>..<to>`: one period between changes. It may start on a change's day, since that change starts it,
 * but no change may come after its first day and on or before its last.
 */
export const parsePeriod = (text: string, changes: readonly Change[]): Readonly<{ period: Period } | { refused: PeriodRefusal }> => {
  const [from, to, ...rest] = text.split("..");
  if (rest.length > 0 || !isDay(from) || !isDay(to) || from > to) return { refused: "PERIOD_MALFORMED" };
  return changes.some(({ date }) => date > from && date <= to) ? { refused: "PERIOD_SPANS_CHANGE" } : { period: Object.freeze({ from, to }) };
};
