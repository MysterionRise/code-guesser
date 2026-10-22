import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CONTROL, FACTORS, type Arms, type Factor } from "../../apps/game/src/experiment/arms";
import { isDay, parseEvent, type EventSource, type ExperimentEvent } from "../../apps/game/src/experiment/events";
import { DECK_IDS } from "../../packages/artifact/src/index";
import { changesWithin, periodsOf, type Change, type Period } from "./changes";
import { compareArms, median, percentile95, sampleSize, type ArmComparison } from "./statistics";

/**
 * The experiment report (#108): reads the event store (#107) with no network and compares each factor's levels
 * (#106) on the pre-registered primary metric, with the secondary metrics and the accuracy guardrail beside it.
 * Factors are drawn independently, so each factor's comparison counts every game, whatever its other levels. The game
 * keeps changing after launch, so the report lists the dated changes in its window and can read one period between
 * them (#169).
 */

/** Version 2 (#169): completion counts viewed games, and the report carries its changes, periods, and viewed count. */
export const REPORT_VERSION = 2;
const FACTOR_NAMES = Object.keys(FACTORS) as Factor[];

/** The decks a stored event may name: every artifact deck, the mix, and today's five. */
export const EVENT_DECKS: readonly string[] = Object.freeze([...DECK_IDS, "mixed", "daily"]);

/**
 * The pre-registered plan, fixed before real games arrive. Each factor's target is the completed games per level
 * that detect a 10-point rise in the deal-again rate over 30%, at α 0.05 split over that factor's comparisons with
 * control, with power 0.8. The result is read when every level reaches its target or after eight weeks.
 */
export const PLAN = Object.freeze({
  base: 0.3,
  lift: 0.1,
  alpha: 0.05,
  power: 0.8,
  maximumDays: 56,
});
export const targetFor = (factor: Factor): number =>
  sampleSize({ base: PLAN.base, lift: PLAN.lift, comparisons: FACTORS[factor].length - 1, alpha: PLAN.alpha, power: PLAN.power });

/** What the store holds for one source: its parsed events, the lines refused, and the rolled-up groups left out. */
export interface StoreRead {
  readonly events: readonly ExperimentEvent[];
  readonly refused: number;
  readonly rolledUp: number;
}

const DAY_FILE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/u;
const lines = (path: string): string[] => {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

/**
 * Reads the raw days from `from` to `to` (both included) for one source. A line the schema refuses is counted, never
 * shown. Days older than the raw retention are only daily totals, which carry no games; they are counted and left
 * out, since the plan reads the result within eight weeks.
 */
export const readStore = (directory: string, source: EventSource, from = "0000-00-00", to = "9999-99-99"): StoreRead => {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    names = [];
  }
  const days = names.flatMap((name) => DAY_FILE.exec(name)?.[1] ?? []).filter((day) => isDay(day) && day >= from && day <= to).sort();
  let refused = 0;
  const events: ExperimentEvent[] = [];
  for (const day of days) {
    for (const line of lines(join(directory, `events-${day}.jsonl`))) {
      let event: ExperimentEvent | null = null;
      try {
        event = parseEvent(JSON.parse(line) as unknown, EVENT_DECKS);
      } catch {
        event = null;
      }
      if (event === null) refused += 1;
      else if (event.source === source) events.push(event);
    }
  }
  return Object.freeze({ events: Object.freeze(events), refused, rolledUp: lines(join(directory, "totals.jsonl")).length });
};

/** One game as its events tell it. */
export interface Game {
  readonly deck: string;
  readonly arms: Arms;
  readonly firstDay: string;
  /** Its page sent `game_viewed`, so a browser ran it; a crawler's or a link preview's deal never does (#169). */
  readonly viewed: boolean;
  readonly completed: boolean;
  readonly dealtAgain: boolean;
  readonly rounds: readonly Readonly<{ correct: boolean; hints: number; ms: number }>[];
  readonly calls: readonly Readonly<{ ms: number; tokensIn: number; tokensOut: number }>[];
  readonly chatTurns: number;
  readonly fallbacks: number;
}

/** Groups events by game; a game's arms are sealed at its deal, so every event of it carries the same ones. */
export const gamesOf = (events: readonly ExperimentEvent[]): readonly Game[] => {
  const byGame = new Map<string, ExperimentEvent[]>();
  for (const event of events) byGame.set(event.game, [...byGame.get(event.game) ?? [], event]);
  return Object.freeze([...byGame.values()].map((own) => {
    const first = own[0]!;
    const of = (type: string) => own.filter((event) => event.type === type);
    return Object.freeze({
      deck: first.deck,
      arms: Object.freeze(Object.fromEntries(FACTOR_NAMES.map((factor) => [factor, first[factor]]))) as Arms,
      firstDay: own.map(({ day }) => day).sort()[0]!,
      viewed: of("game_viewed").length > 0,
      completed: of("game_completed").length > 0,
      dealtAgain: of("deal_again").length > 0,
      rounds: of("round_revealed").map((event) => ({ correct: event.correct === true, hints: event.hints as number, ms: event.ms as number })),
      calls: of("genui_call").map((event) => ({ ms: event.ms as number, tokensIn: event.tokensIn as number, tokensOut: event.tokensOut as number })),
      chatTurns: of("genui_interaction").filter((event) => event.action === "chat").length,
      fallbacks: of("genui_fallback").length,
    });
  }));
};

/** Model prices in US dollars per million tokens, given on the command line; without them cost is not reported. */
export type Prices = Readonly<{ input: number; output: number }> | null;

/** The secondary metrics of a group of games. */
export interface Secondary {
  readonly games: number;
  /** Viewed games that reached their fifth round (#169): a deal no browser ran never counts against it. */
  readonly completion: number | null;
  readonly accuracy: number | null;
  readonly hintsPerRound: number | null;
  readonly medianRoundSeconds: number | null;
  readonly chatTurnsPerGame: number | null;
  readonly fallbacksPerRound: number | null;
  readonly p95ModelSeconds: number | null;
  readonly costPerGame: number | null;
}

const ratio = (part: number, whole: number): number | null => whole === 0 ? null : part / whole;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

export const secondaryOf = (games: readonly Game[], prices: Prices): Secondary => {
  const viewed = games.filter(({ viewed: isViewed }) => isViewed);
  const rounds = games.flatMap(({ rounds: own }) => own);
  const calls = games.flatMap(({ calls: own }) => own);
  const roundMs = median(rounds.map(({ ms }) => ms));
  const callMs = percentile95(calls.map(({ ms }) => ms));
  const cost = prices === null ? null
    : (sum(calls.map(({ tokensIn }) => tokensIn)) * prices.input + sum(calls.map(({ tokensOut }) => tokensOut)) * prices.output) / 1_000_000;
  return Object.freeze({
    games: games.length,
    completion: ratio(viewed.filter(({ completed }) => completed).length, viewed.length),
    accuracy: ratio(rounds.filter(({ correct }) => correct).length, rounds.length),
    hintsPerRound: ratio(sum(rounds.map(({ hints }) => hints)), rounds.length),
    medianRoundSeconds: roundMs === null ? null : roundMs / 1000,
    chatTurnsPerGame: ratio(sum(games.map(({ chatTurns }) => chatTurns)), games.length),
    fallbacksPerRound: ratio(sum(games.map(({ fallbacks }) => fallbacks)), rounds.length),
    p95ModelSeconds: callMs === null ? null : callMs / 1000,
    costPerGame: cost === null ? null : ratio(cost, games.length),
  });
};

export interface LevelRow {
  readonly level: string;
  readonly completed: number;
  readonly target: number;
  /** The primary metric, the deal-again rate over completed games. */
  readonly primary: ArmComparison;
  /** The guardrail, accuracy over revealed rounds; a level clearly above control may be leaking answers (#102). */
  readonly accuracy: ArmComparison;
  readonly secondary: Secondary;
}

export interface FactorReport {
  readonly factor: Factor;
  readonly control: string;
  readonly target: number;
  /** The decks whose games count: every deck, except that layers count only on decks that have them. */
  readonly decks: "all" | readonly string[];
  readonly levels: readonly LevelRow[];
  /** Levels whose accuracy is above control's with 95% posterior probability. */
  readonly guardrail: readonly string[];
}

export interface InteractionCell { readonly rows: string; readonly columns: string; readonly completed: number; readonly dealtAgain: number }
export interface Interaction { readonly factors: readonly [Factor, Factor]; readonly cells: readonly InteractionCell[] }

export interface Report {
  readonly v: typeof REPORT_VERSION;
  readonly source: EventSource;
  readonly from: string | null;
  readonly to: string;
  /** The one period between changes this report reads, when `--period` names it (#169). */
  readonly period: Period | null;
  readonly games: number;
  /** Games whose page sent `game_viewed`: completion's denominator. */
  readonly viewed: number;
  readonly completed: number;
  readonly refused: number;
  readonly rolledUp: number;
  /** The player-visible changes dated inside the window, and the periods between them that the window holds. */
  readonly changes: readonly Change[];
  readonly periods: readonly Period[];
  readonly plan: typeof PLAN & Readonly<{ targets: Readonly<Record<Factor, number>>; layerDecks: readonly string[] }>;
  /** The stopping rule: whether the result may be read now, and why not. */
  readonly readiness: Readonly<{ ready: boolean; day: number | null; short: readonly string[] }>;
  readonly factors: readonly FactorReport[];
  /** Two-way tables of the primary metric, descriptive only: the plan makes no claim about them. */
  readonly interactions: readonly Interaction[];
}

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const inScope = (factor: Factor, layerDecks: readonly string[]) => (game: Game): boolean =>
  factor !== "layer" || layerDecks.includes(game.deck);

const factorReport = (factor: Factor, games: readonly Game[], layerDecks: readonly string[], prices: Prices, seed: number): FactorReport => {
  const scoped = games.filter(inScope(factor, layerDecks));
  const levels = FACTORS[factor] as readonly string[];
  const byLevel = levels.map((level) => scoped.filter(({ arms }) => arms[factor] === level));
  const completedBy = byLevel.map((own) => own.filter(({ completed }) => completed));
  const primary = compareArms(levels.map((level, index) => ({
    level, successes: completedBy[index]!.filter(({ dealtAgain }) => dealtAgain).length, trials: completedBy[index]!.length,
  })), CONTROL[factor], seed);
  const accuracy = compareArms(levels.map((level, index) => {
    const rounds = byLevel[index]!.flatMap(({ rounds: own }) => own);
    return { level, successes: rounds.filter(({ correct }) => correct).length, trials: rounds.length };
  }), CONTROL[factor], seed + 1);
  const target = targetFor(factor);
  return Object.freeze({
    factor,
    control: CONTROL[factor],
    target,
    decks: factor === "layer" ? layerDecks : "all" as const,
    levels: Object.freeze(levels.map((level, index) => Object.freeze({
      level, completed: completedBy[index]!.length, target, primary: primary[index]!, accuracy: accuracy[index]!,
      secondary: secondaryOf(byLevel[index]!, prices),
    }))),
    guardrail: Object.freeze(accuracy.filter(({ difference, trials }) => trials > 0 && difference !== null && difference.low > 0).map(({ level }) => level)),
  });
};

const interaction = (pair: readonly [Factor, Factor], games: readonly Game[], layerDecks: readonly string[]): Interaction => {
  const [rows, columns] = pair;
  const scoped = games.filter((game) => inScope(rows, layerDecks)(game) && inScope(columns, layerDecks)(game) && game.completed);
  return Object.freeze({
    factors: pair,
    cells: Object.freeze((FACTORS[rows] as readonly string[]).flatMap((row) => (FACTORS[columns] as readonly string[]).map((column) => {
      const cell = scoped.filter(({ arms }) => arms[rows] === row && arms[columns] === column);
      return Object.freeze({ rows: row, columns: column, completed: cell.length, dealtAgain: cell.filter(({ dealtAgain }) => dealtAgain).length });
    }))),
  });
};

/**
 * The whole report for one source's events, read up to `to`, the day the report is for. Its window starts at the
 * period it was asked for, or else at its first game, and `changes` is the whole log; the report keeps those inside.
 */
export const buildReport = ({ read, source, to, layerDecks, prices = null, changes = [], period = null }: Readonly<{
  read: StoreRead; source: EventSource; to: string; layerDecks: readonly string[]; prices?: Prices;
  changes?: readonly Change[]; period?: Period | null;
}>): Report => {
  const games = gamesOf(read.events);
  const from = games.length === 0 ? null : games.map(({ firstDay }) => firstDay).sort()[0]!;
  const start = period?.from ?? from;
  const factors = FACTOR_NAMES.map((factor, index) => factorReport(factor, games, layerDecks, prices, 108 + 10 * index));
  const short = factors.flatMap(({ factor, levels }) => levels.filter(({ completed, target }) => completed < target)
    .map(({ level, completed, target }) => `${factor}:${level} ${completed}/${target}`));
  const day = from === null ? null : daysBetween(from, to);
  return Object.freeze({
    v: REPORT_VERSION,
    source,
    from,
    to,
    period,
    games: games.length,
    viewed: games.filter(({ viewed }) => viewed).length,
    completed: games.filter(({ completed }) => completed).length,
    refused: read.refused,
    rolledUp: read.rolledUp,
    changes: changesWithin(changes, start, to),
    periods: start === null ? Object.freeze([]) : periodsOf(changes, start, to),
    plan: Object.freeze({
      ...PLAN,
      targets: Object.freeze(Object.fromEntries(FACTOR_NAMES.map((factor) => [factor, targetFor(factor)]))) as Readonly<Record<Factor, number>>,
      layerDecks: Object.freeze([...layerDecks]),
    }),
    readiness: Object.freeze({ ready: short.length === 0 || (day !== null && day >= PLAN.maximumDays), day, short: Object.freeze(short) }),
    factors: Object.freeze(factors),
    interactions: Object.freeze(([["design", "theme"], ["design", "layer"], ["theme", "layer"]] as const).map((pair) => interaction(pair, games, layerDecks))),
  });
};

/** The decks the committed question layers cover, read from the layers file's round ids. */
export const layerDecksFrom = (path: string): readonly string[] => {
  let layers: unknown;
  try {
    layers = (JSON.parse(readFileSync(path, "utf8")) as { layers?: unknown }).layers;
  } catch {
    return [];
  }
  if (!Array.isArray(layers)) return [];
  const decks = layers.flatMap((layer) => {
    const roundId = (layer as { roundId?: unknown } | null)?.roundId;
    const deck = typeof roundId === "string" ? /^local-([a-z-]+)-[0-9a-f]+$/u.exec(roundId)?.[1] : undefined;
    return deck !== undefined && EVENT_DECKS.includes(deck) ? [deck] : [];
  });
  return Object.freeze([...new Set(decks)].sort());
};
