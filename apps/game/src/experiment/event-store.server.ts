import "server-only";

import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { FACTORS, type Arms } from "./arms";
import { CLIENT_EVENT_TYPES, EVENT_SCHEMA_VERSION, EVENT_TYPES, SOURCES, dayOf, isDay, parseEvent, parsePayload, type EventSource, type EventType, type ExperimentEvent } from "./events";

/**
 * Where events go (#107): a small store interface, so a host can put Postgres behind it later. The local store is
 * one append-only JSON-lines file per UTC day. Raw events are kept for 90 days, then rolled up into daily totals per
 * deck and arms, and the raw day is deleted.
 */
export interface EventStore {
  append(event: ExperimentEvent): void;
  /** Raw events from `fromDay` to `toDay`, both included, in the order they were written. */
  read(fromDay: string, toDay: string): readonly ExperimentEvent[];
  /** Days that still hold raw events. */
  days(): readonly string[];
  /** Rolls up every raw day older than `keepDays` before `today`; returns the days rolled up. */
  rollUp(today: string, keepDays?: number): readonly string[];
  totals(): readonly DailyTotal[];
}

/** One day's events for one deck, source, and set of arms, counted by type, with the sums a report needs. */
export interface DailyTotal extends Arms {
  readonly v: typeof EVENT_SCHEMA_VERSION;
  readonly day: string;
  readonly source: EventSource;
  readonly deck: string;
  readonly counts: Readonly<Record<EventType, number>>;
  /** Right answers, hints bought, and model tokens, summed over the day's events. */
  readonly correct: number;
  readonly hints: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export const RAW_RETENTION_DAYS = 90;
const DAY_FILE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/u;
const TOTALS_FILE = "totals.jsonl";

const daysBefore = (day: string, days: number): string => dayOf(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000);

/** The game's own totals key: everything a daily total groups by. */
const groupKey = (event: ExperimentEvent): string =>
  JSON.stringify([event.day, event.source, event.deck, ...Object.keys(FACTORS).map((factor) => event[factor as keyof Arms])]);

const totalFor = (events: readonly ExperimentEvent[]): DailyTotal => {
  const first = events[0]!;
  const counts = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0])) as Record<EventType, number>;
  let correct = 0, hints = 0, tokensIn = 0, tokensOut = 0;
  for (const event of events) {
    counts[event.type] += 1;
    if (event.type === "round_revealed") { correct += event.correct === true ? 1 : 0; hints += event.hints as number; }
    if (event.type === "genui_call") { tokensIn += event.tokensIn as number; tokensOut += event.tokensOut as number; }
  }
  return Object.freeze({
    v: EVENT_SCHEMA_VERSION, day: first.day, source: first.source, deck: first.deck,
    ...Object.fromEntries(Object.keys(FACTORS).map((factor) => [factor, first[factor as keyof Arms]])) as unknown as Arms,
    counts: Object.freeze(counts), correct, hints, tokensIn, tokensOut,
  });
};

/** A store of JSON-lines files in one directory; it refuses any event the schema refuses. */
export const fileEventStore = (directory: string, decks: readonly string[]): EventStore => {
  const dayPath = (day: string): string => join(directory, `events-${day}.jsonl`);
  const readLines = (path: string): unknown[] => {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as unknown);
  };
  const days = (): string[] => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return [];
    }
    return names.flatMap((name) => DAY_FILE.exec(name)?.[1] ?? []).filter(isDay).sort();
  };
  const read = (fromDay: string, toDay: string): ExperimentEvent[] => days()
    .filter((day) => day >= fromDay && day <= toDay)
    .flatMap((day) => readLines(dayPath(day)).flatMap((value) => parseEvent(value, decks) ?? []));
  return Object.freeze({
    append: (event: ExperimentEvent) => {
      const checked = parseEvent(event, decks);
      if (checked === null) throw new Error("EXPERIMENT_EVENT_REJECTED");
      mkdirSync(directory, { recursive: true });
      appendFileSync(dayPath(checked.day), `${JSON.stringify(checked)}\n`, "utf8");
    },
    read,
    days,
    rollUp: (today: string, keepDays = RAW_RETENTION_DAYS) => {
      const cutoff = daysBefore(today, keepDays);
      const old = days().filter((day) => day < cutoff);
      if (old.length === 0) return [];
      const groups = new Map<string, ExperimentEvent[]>();
      for (const event of read(old[0]!, old.at(-1)!)) {
        const key = groupKey(event);
        groups.set(key, [...groups.get(key) ?? [], event]);
      }
      const lines = [...groups.values()].map((events) => `${JSON.stringify(totalFor(events))}\n`).join("");
      // Totals are appended before the raw days are deleted, so a crash loses nothing; a crash between the two
      // would count those days again on the next roll-up.
      appendFileSync(join(directory, TOTALS_FILE), lines, "utf8");
      for (const day of old) rmSync(dayPath(day));
      return Object.freeze(old);
    },
    totals: () => Object.freeze(readLines(join(directory, TOTALS_FILE)) as DailyTotal[]),
  });
};

/** `EXPERIMENT_SOURCE`, for playtests (`agent`) and synthetic checks; anything else is a real game. */
export const eventSource = (env: Readonly<Record<string, string | undefined>> = process.env): EventSource =>
  (SOURCES as readonly string[]).includes(env.EXPERIMENT_SOURCE ?? "") ? env.EXPERIMENT_SOURCE as EventSource : "real";

/** What the game reports about one game: its type, its own fields, and the game's id, deck, and arms. */
export type GameEvent = Readonly<{ type: EventType; game: string; deck: string; arms: Arms; fields: Readonly<Record<string, string | number | boolean>> }>;
export type EventSink = (event: GameEvent, now: number) => void;

/**
 * A sink that completes each game event with the schema version, its day, and the source, and appends it; a write
 * that fails is logged as a code and never stops the game. Events are opt-in: with no `EXPERIMENT_EVENTS_DIR` there
 * is no sink and nothing is recorded.
 */
export const storeSink = (store: EventStore, source: EventSource): EventSink => {
  let rolledOn: string | undefined;
  return ({ type, game, deck, arms, fields }, now) => {
    try {
      if (parsePayload(type, fields) === null) throw new Error("EXPERIMENT_EVENT_REJECTED");
      const day = dayOf(now);
      store.append({ v: EVENT_SCHEMA_VERSION, type, game, day, source, deck, ...arms, ...fields } as ExperimentEvent);
      if (rolledOn !== day) { rolledOn = day; store.rollUp(day); }
    } catch (error) {
      console.error(`EXPERIMENT_EVENT_FAILED ${error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "WRITE"}`);
    }
  };
};

/** The process's sink, from the environment: none unless `EXPERIMENT_EVENTS_DIR` names a directory. */
export const eventSinkFromEnv = (decks: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): EventSink | null => {
  const directory = env.EXPERIMENT_EVENTS_DIR;
  return directory === undefined || directory.length === 0 ? null : storeSink(fileEventStore(directory, decks), eventSource(env));
};

/** The events the server records itself; the rest arrive from the browser through the beacon route. */
export const SERVER_EVENT_TYPES = Object.freeze(EVENT_TYPES.filter((type) => !(CLIENT_EVENT_TYPES as readonly string[]).includes(type)));
