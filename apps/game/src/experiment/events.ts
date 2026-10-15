import { FACTORS, isLevel, type Arms } from "./arms";

/**
 * The anonymous event log's schema (#107), version 1. An event says what happened in one game and under which arms,
 * never who played it: no IP address, user agent, cookie, persistent id, chat text, round content, or chosen
 * option. The parser takes exact keys, closed enums, and bounded numbers, so a field the schema doesn't name is
 * refused rather than stored.
 */

export const EVENT_SCHEMA_VERSION = 1;

/** Where events came from, so playtests and synthetic checks never mix with real games. */
export const SOURCES = Object.freeze(["real", "agent", "synthetic"] as const);
export type EventSource = (typeof SOURCES)[number];

const VIEWPORTS = ["phone", "tablet", "desktop"] as const;
const PHASES = ["before-lock", "after-lock"] as const;
const DEAL_TARGETS = ["same-deck", "chooser"] as const;
const GENUI_ACTIONS = ["explain", "chat", "quiz", "offer_hint", "step"] as const;
const GENUI_FALLBACKS = ["unavailable", "refused", "failed", "rejected"] as const;
const DAY_MS = 86_400_000;

type Check = (value: unknown) => boolean;
const count = (maximum: number): Check => (value) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
const between = (minimum: number, maximum: number): Check => (value) => count(maximum)(value) && (value as number) >= minimum;
const oneOf = (values: readonly string[]): Check => (value) => typeof value === "string" && values.includes(value);
const flag: Check = (value) => typeof value === "boolean";
const round = between(1, 5);
const ms = count(DAY_MS);

/** Each event's own fields, beside the fields every event carries. */
const PAYLOADS = {
  game_dealt: {},
  game_viewed: { viewport: oneOf(VIEWPORTS) },
  hint_revealed: { round, hint: between(1, 2), ms },
  round_revealed: { round, correct: flag, hints: count(2), ms },
  game_completed: { score: count(1_000_000), correct: count(5), hints: count(10), ms },
  deal_again: { to: oneOf(DEAL_TARGETS) },
  result_copied: {},
  genui_call: { round, phase: oneOf(PHASES), ok: flag, status: count(599), calls: count(20), tokensIn: count(1_000_000), tokensOut: count(100_000), ms },
  genui_interaction: { round, action: oneOf(GENUI_ACTIONS) },
  genui_fallback: { round, reason: oneOf(GENUI_FALLBACKS) },
} as const satisfies Record<string, Record<string, Check>>;

export type EventType = keyof typeof PAYLOADS;
export const EVENT_TYPES = Object.freeze(Object.keys(PAYLOADS) as EventType[]);

/** The events only a browser sees; it sends them to the beacon route, which adds the game's own fields. */
export const CLIENT_EVENT_TYPES = Object.freeze(["game_viewed", "deal_again", "result_copied", "genui_interaction", "genui_fallback"] as const);
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export type Viewport = (typeof VIEWPORTS)[number];
export type DealTarget = (typeof DEAL_TARGETS)[number];
export type GenuiAction = (typeof GENUI_ACTIONS)[number];
export type GenuiFallback = (typeof GENUI_FALLBACKS)[number];
/** What a generative panel reports; the shell adds the round it belongs to. */
export type GenuiEvent = Readonly<{ type: "genui_interaction"; action: GenuiAction } | { type: "genui_fallback"; reason: GenuiFallback }>;

/** A browser-only event as the browser sends it; the beacon route checks it against the same payload rules. */
export type ClientEvent =
  | Readonly<{ type: "game_viewed"; viewport: Viewport }>
  | Readonly<{ type: "deal_again"; to: DealTarget }>
  | Readonly<{ type: "result_copied" }>
  | (GenuiEvent & Readonly<{ round: number }>);

/** What every event carries: the schema, the game, the day (UTC, no time), the source, the deck, and the arms. */
export interface EventBase extends Arms {
  readonly v: typeof EVENT_SCHEMA_VERSION;
  readonly type: EventType;
  /** The game's random id from its sealed token; it links nothing beyond that one game. */
  readonly game: string;
  readonly day: string;
  readonly source: EventSource;
  readonly deck: string;
}
export type ExperimentEvent = EventBase & Readonly<Record<string, string | number | boolean>>;

const BASE_KEYS = ["v", "type", "game", "day", "source", "deck", ...Object.keys(FACTORS)];

export const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // An impossible date such as 2026-02-30 either fails to parse or rolls over to another day.
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
};

/** The UTC day of a moment, the only time an event records. */
export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** One event's fields beside the base, when they fit its type exactly; otherwise null. */
export const parsePayload = (type: unknown, fields: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number | boolean>> | null => {
  if (typeof type !== "string" || !Object.hasOwn(PAYLOADS, type)) return null;
  const checks = PAYLOADS[type as EventType] as Readonly<Record<string, Check>>;
  const keys = Object.keys(fields);
  if (keys.length !== Object.keys(checks).length || keys.some((key) => !Object.hasOwn(checks, key) || !checks[key]!(fields[key]))) return null;
  return Object.freeze({ ...fields }) as Readonly<Record<string, string | number | boolean>>;
};

/** A stored event, when every field fits: exact keys, a known deck, closed enums, and bounded numbers. */
export const parseEvent = (value: unknown, decks: readonly string[]): ExperimentEvent | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const base: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(record)) (BASE_KEYS.includes(key) ? base : rest)[key] = field;
  if (Object.keys(base).length !== BASE_KEYS.length
    || record.v !== EVENT_SCHEMA_VERSION
    || typeof record.game !== "string" || !/^[0-9a-f]{32}$/u.test(record.game)
    || !isDay(record.day)
    || !oneOf(SOURCES)(record.source)
    || !oneOf(decks)(record.deck)
    || !(Object.keys(FACTORS) as (keyof typeof FACTORS)[]).every((factor) => isLevel(factor, record[factor]))) return null;
  const payload = parsePayload(record.type, rest);
  return payload === null ? null : Object.freeze({ ...record }) as ExperimentEvent;
};

/** A browser's viewport, as a bucket rather than a size. */
export const viewportBucket = (width: number): "phone" | "tablet" | "desktop" => width < 640 ? "phone" : width < 1024 ? "tablet" : "desktop";
