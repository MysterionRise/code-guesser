import type { DuelVerdict, FirstPlay } from "../components/duel/duel-contract";
import { FACTORS, isLevel, type Arms } from "./arms";

/**
 * The anonymous event log's schema (#107), version 2. An event says what happened in one game and under which arms,
 * never who played it: no IP address, user agent, cookie, persistent id, chat text, round content, or chosen
 * option. The parser takes exact keys, closed enums, and bounded numbers, so a field the schema doesn't name is
 * refused rather than stored.
 *
 * Version 2 (#173) says where each game came from (`origin`): a deal of its own, or a friend's game of a duel challenge,
 * which plays the challenger's arms. It adds the duel events and the rematch, and takes in what version 1 grew: the
 * shared result (#171) and the `limited` fallback (#98). No duel event names a challenge, a link, a name, or the other
 * side's game. Lines stored under version 1 still parse, as a deal's; the store writes only version 2.
 */

export const EVENT_SCHEMA_VERSION = 2;
/** The versions the parser reads. */
export type EventVersion = 1 | typeof EVENT_SCHEMA_VERSION;

/** Where events came from, so playtests and synthetic checks never mix with real games. */
export const SOURCES = Object.freeze(["real", "agent", "synthetic"] as const);
export type EventSource = (typeof SOURCES)[number];

/**
 * How a game came to be dealt (#173): a deal of its own, whose arms were drawn for it, or a friend's game of a duel
 * challenge, whose arms are the challenger's, so the report keeps it out of the comparisons.
 */
export const ORIGINS = Object.freeze(["deal", "duel"] as const);
export type EventOrigin = (typeof ORIGINS)[number];

// Every closed choice is exported, so the privacy page (#99) lists the very values the parser takes.
export const VIEWPORTS = Object.freeze(["phone", "tablet", "desktop"] as const);
export const PHASES = Object.freeze(["before-lock", "after-lock"] as const);
/** Where a finished game went: a new deal of its deck, the chooser, or, from a friend's game of a duel, a rematch. */
export const DEAL_TARGETS = Object.freeze(["same-deck", "chooser", "rematch"] as const);
export const SHARE_ROUTES = Object.freeze(["share", "clipboard"] as const);
export const GENUI_ACTIONS = Object.freeze(["explain", "chat", "quiz", "offer_hint", "step"] as const);
/** Why a generative panel fell back; `limited` is a rate limit or a game's cap (#98). */
export const GENUI_FALLBACKS = Object.freeze(["unavailable", "refused", "failed", "rejected", "limited"] as const);
/** Whether a challenger's game was its deal's first try (`FirstPlay`); today's five is everyone's, so `shared`. */
export const FIRST_PLAYS = Object.freeze(["yes", "no", "shared"] as const satisfies readonly FirstPlay[]);
/** A duel's outcome, from the friend's side, and what decided it (`duelVerdict`). */
export const DUEL_OUTCOMES = Object.freeze(["won", "lost", "drew"] as const);
export const DUEL_DECIDERS = Object.freeze(["score", "hints", "correct", "draw"] as const satisfies readonly DuelVerdict["decidedBy"][]);
export const DUEL_LINKS = Object.freeze(["challenge", "result"] as const);
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
  result_shared: { via: oneOf(SHARE_ROUTES) },
  genui_call: { round, phase: oneOf(PHASES), ok: flag, status: count(599), calls: count(20), tokensIn: count(1_000_000), tokensOut: count(100_000), ms },
  genui_interaction: { round, action: oneOf(GENUI_ACTIONS) },
  genui_fallback: { round, reason: oneOf(GENUI_FALLBACKS) },
  /** A finished game became a challenge, once per challenge however often its link is asked for again. */
  duel_created: { firstPlay: oneOf(FIRST_PLAYS) },
  /** A friend's finished game of a challenge got its first result: how the friend did against the challenger. */
  duel_completed: { outcome: oneOf(DUEL_OUTCOMES), decidedBy: oneOf(DUEL_DECIDERS) },
  /** A challenge or result link went onto the share sheet or the clipboard. */
  duel_link_copied: { link: oneOf(DUEL_LINKS), via: oneOf(SHARE_ROUTES) },
} as const satisfies Record<string, Record<string, Check>>;

/**
 * Events nothing sends any more, still read in the lines stored under version 1: `result_copied` became
 * `result_shared` (#171), which also says whether the share sheet or the clipboard took it.
 */
const RETIRED = { result_copied: {} } as const satisfies Record<string, Record<string, Check>>;

/** Version 1's events as it stored them: none of the duels' (#173), no rematch, and the retired copy. */
const V1_PAYLOADS: Readonly<Record<string, Readonly<Record<string, Check>>>> = Object.freeze({
  ...Object.fromEntries(Object.entries(PAYLOADS).filter(([type]) => !type.startsWith("duel_"))),
  deal_again: { to: oneOf(DEAL_TARGETS.filter((to) => to !== "rematch")) },
  ...RETIRED,
});

export type EventType = keyof typeof PAYLOADS | keyof typeof RETIRED;
/** Every type a stored line may carry, the retired ones included. */
export const EVENT_TYPES = Object.freeze([...Object.keys(PAYLOADS), ...Object.keys(RETIRED)] as EventType[]);
export const RETIRED_EVENT_TYPES = Object.freeze(Object.keys(RETIRED) as (keyof typeof RETIRED)[]);
/** The types the current version writes. */
export type CurrentEventType = keyof typeof PAYLOADS;
/** Each type's own fields by name, as the current version writes them: what the privacy page lists (#99). */
export const EVENT_FIELDS = Object.freeze(Object.fromEntries(Object.entries(PAYLOADS)
  .map(([type, checks]) => [type, Object.freeze(Object.keys(checks))]))) as Readonly<Record<CurrentEventType, readonly string[]>>;

/** The events only a browser sees; it sends them to the beacon route, which adds the game's own fields. */
export const CLIENT_EVENT_TYPES = Object.freeze(["game_viewed", "deal_again", "result_shared", "genui_interaction", "genui_fallback",
  "duel_link_copied"] as const);
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export type Viewport = (typeof VIEWPORTS)[number];
export type DealTarget = (typeof DEAL_TARGETS)[number];
export type ShareRoute = (typeof SHARE_ROUTES)[number];
export type GenuiAction = (typeof GENUI_ACTIONS)[number];
export type GenuiFallback = (typeof GENUI_FALLBACKS)[number];
export type DuelOutcome = (typeof DUEL_OUTCOMES)[number];
export type DuelLink = (typeof DUEL_LINKS)[number];
/** What a generative panel reports; the shell adds the round it belongs to. */
export type GenuiEvent = Readonly<{ type: "genui_interaction"; action: GenuiAction } | { type: "genui_fallback"; reason: GenuiFallback }>;

/** A browser-only event as the browser sends it; the beacon route checks it against the same payload rules. */
export type ClientEvent =
  | Readonly<{ type: "game_viewed"; viewport: Viewport }>
  | Readonly<{ type: "deal_again"; to: DealTarget }>
  | Readonly<{ type: "result_shared"; via: ShareRoute }>
  | Readonly<{ type: "duel_link_copied"; link: DuelLink; via: ShareRoute }>
  | (GenuiEvent & Readonly<{ round: number }>);

/** What every event carries: the schema, the game, the day (UTC, no time), the source, the origin, the deck, and the arms. */
export interface EventBase extends Arms {
  readonly v: EventVersion;
  readonly type: EventType;
  /** The game's random id from its sealed token; it links nothing beyond that one game. */
  readonly game: string;
  readonly day: string;
  readonly source: EventSource;
  /** A deal's game or a duel's (#173); a line stored under version 1 reads as a deal's. */
  readonly origin: EventOrigin;
  readonly deck: string;
}
export type ExperimentEvent = EventBase & Readonly<Record<string, string | number | boolean>>;

const BASE_KEYS = ["v", "type", "game", "day", "source", "origin", "deck", ...Object.keys(FACTORS)];
const V1_BASE_KEYS = BASE_KEYS.filter((key) => key !== "origin");
/** The fields every event carries under the current version, in the order a stored line writes them. */
export const EVENT_BASE_KEYS: readonly string[] = Object.freeze([...BASE_KEYS]);

export const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // An impossible date such as 2026-02-30 either fails to parse or rolls over to another day.
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
};

/** The UTC day of a moment, the only time an event records. */
export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** One event's fields beside the base, when they fit its type exactly under that version; otherwise null. */
export const parsePayload = (type: unknown, fields: Readonly<Record<string, unknown>>, version: EventVersion = EVENT_SCHEMA_VERSION):
  Readonly<Record<string, string | number | boolean>> | null => {
  const payloads: Readonly<Record<string, Readonly<Record<string, Check>>>> = version === 1 ? V1_PAYLOADS : PAYLOADS;
  if (typeof type !== "string" || !Object.hasOwn(payloads, type)) return null;
  const checks = payloads[type]!;
  const keys = Object.keys(fields);
  if (keys.length !== Object.keys(checks).length || keys.some((key) => !Object.hasOwn(checks, key) || !checks[key]!(fields[key]))) return null;
  return Object.freeze({ ...fields }) as Readonly<Record<string, string | number | boolean>>;
};

/**
 * A stored event, when every field fits its version: exact keys, a known deck, closed enums, and bounded numbers. A
 * line stored under version 1 has no origin; no duel game recorded events then, so it reads as a deal's.
 */
export const parseEvent = (value: unknown, decks: readonly string[]): ExperimentEvent | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 && record.v !== EVENT_SCHEMA_VERSION) return null;
  const version = record.v as EventVersion;
  const baseKeys = version === 1 ? V1_BASE_KEYS : BASE_KEYS;
  const base: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(record)) (baseKeys.includes(key) ? base : rest)[key] = field;
  if (Object.keys(base).length !== baseKeys.length
    || typeof record.game !== "string" || !/^[0-9a-f]{32}$/u.test(record.game)
    || !isDay(record.day)
    || !oneOf(SOURCES)(record.source)
    || (version !== 1 && !oneOf(ORIGINS)(record.origin))
    || !oneOf(decks)(record.deck)
    || !(Object.keys(FACTORS) as (keyof typeof FACTORS)[]).every((factor) => isLevel(factor, record[factor]))) return null;
  const payload = parsePayload(record.type, rest, version);
  return payload === null ? null : Object.freeze(version === 1 ? { ...record, origin: "deal" } : { ...record }) as ExperimentEvent;
};

/** A browser's viewport, as a bucket rather than a size. */
export const viewportBucket = (width: number): "phone" | "tablet" | "desktop" => width < 640 ? "phone" : width < 1024 ? "tablet" : "desktop";
