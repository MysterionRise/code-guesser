/**
 * Personal records (#63), kept in this browser alone: each deck's best score, games played, and streaks, and the run
 * of days on which the player finished today's five. Nothing here is sent anywhere, and there is no account: "Clear
 * records", or clearing the browser's data, forgets them. They belong to one round set, so a new artifact starts afresh.
 *
 * Every finished game counts toward its deck, a friend's game of a duel challenge (#173) included: it is a game of that
 * deck, new to this player. Today's five counts once a day, so playing it again that day counts for nothing.
 */

/** The browser's storage key, and the version of what it holds; any other version reads as no records. */
export const RECORDS_KEY = "codeguessr.records";
export const RECORDS_VERSION = 1;
/** Raised in this tab when the records change, as the browser's `storage` event is in every other tab. */
export const RECORDS_EVENT = "codeguessr-records";
/** A streak counts consecutive finished games with at least this many of their five rounds right. */
export const STREAK_CORRECT = 3;

/** One deck's records. */
export interface DeckRecord {
  readonly best: number;
  readonly played: number;
  /** Consecutive finished games with three or more right, up to the latest. */
  readonly streak: number;
  readonly bestStreak: number;
}

/** The consecutive dates, by the player's own, on which they finished today's five, up to `last`. */
export interface DayStreak {
  readonly last: string;
  readonly days: number;
  readonly best: number;
}

export interface LocalRecords {
  readonly v: typeof RECORDS_VERSION;
  /** The round set they were kept on (`recordsArtifact`). */
  readonly artifact: string;
  readonly decks: Readonly<Record<string, DeckRecord>>;
  readonly daily: DayStreak | null;
}

/** A finished game as the records take it. */
export interface FinishedGame {
  readonly deck: string;
  readonly score: number;
  readonly correct: number;
  /** Today's five's date, for a game of it; null for any other game. */
  readonly date: string | null;
}

/** Where a game's records go once it finishes: its round set (`recordsArtifact`), its deck, and today's five's date. */
export type GameRecords = Readonly<{ artifact: string } & Pick<FinishedGame, "deck" | "date">>;

/** The part of an artifact's hash records are kept under: enough to tell round sets apart, as a duel link's is. */
export const recordsArtifact = (artifactHash: string): string => artifactHash.slice(0, 16);

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DECK = /^[a-z][a-z-]{0,31}$/u;
const ARTIFACT = /^[0-9a-f]{16}$/u;
/** More decks than any artifact holds; a store with more was not written here. */
const MAXIMUM_DECKS = 32;
const DAY_MS = 86_400_000;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasKeys = (value: unknown, keys: string): value is Readonly<Record<string, unknown>> => isObject(value) && Object.keys(value).sort().join("|") === keys;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const isDeckRecord = (value: unknown): value is DeckRecord => hasKeys(value, "best|bestStreak|played|streak")
  && count(value.best) && count(value.played) && count(value.streak) && count(value.bestStreak)
  && value.played >= 1 && value.streak <= value.bestStreak && value.bestStreak <= value.played;

const isDayStreak = (value: unknown): value is DayStreak => hasKeys(value, "best|days|last")
  && typeof value.last === "string" && DATE.test(value.last) && count(value.days) && count(value.best) && value.days >= 1 && value.days <= value.best;

const isRecords = (value: unknown): value is LocalRecords => hasKeys(value, "artifact|daily|decks|v")
  && value.v === RECORDS_VERSION && typeof value.artifact === "string" && ARTIFACT.test(value.artifact)
  && isObject(value.decks) && Object.keys(value.decks).length <= MAXIMUM_DECKS
  && Object.entries(value.decks).every(([deck, record]) => DECK.test(deck) && isDeckRecord(record))
  && (value.daily === null || isDayStreak(value.daily));

/** No records yet, for a round set. */
export const emptyRecords = (artifact: string): LocalRecords => Object.freeze({ v: RECORDS_VERSION, artifact, decks: Object.freeze({}), daily: null });

/**
 * The records stored for this round set. Anything else reads as none: nothing stored, text that isn't JSON, another
 * version or shape, or another round set's records, which the next finished game replaces.
 */
export const parseRecords = (stored: string | null, artifact: string): LocalRecords => {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    // Unreadable records are no records.
  }
  return isRecords(value) && value.artifact === artifact ? value : emptyRecords(artifact);
};

const dayBefore = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/**
 * The records with a finished game added: its deck's best, games played, and streak, which a game with fewer than three
 * right ends. Today's five on the player's own date (`today`) carries the day streak on, or starts it again, and counts
 * once: playing that date's five again, however it was dealt, changes nothing.
 */
export const recordGame = (records: LocalRecords, game: FinishedGame, today: string): LocalRecords => {
  const { daily } = records;
  if (game.date !== null && daily?.last === game.date) return records;
  const deck = records.decks[game.deck] ?? { best: 0, played: 0, streak: 0, bestStreak: 0 };
  const streak = game.correct >= STREAK_CORRECT ? deck.streak + 1 : 0;
  const decks = Object.freeze({ ...records.decks, [game.deck]: Object.freeze({
    best: Math.max(deck.best, game.score), played: deck.played + 1, streak, bestStreak: Math.max(deck.bestStreak, streak),
  }) });
  if (game.date !== today) return Object.freeze({ ...records, decks });
  const days = daily?.last === dayBefore(today) ? daily.days + 1 : 1;
  return Object.freeze({ ...records, decks, daily: Object.freeze({ last: today, days, best: Math.max(daily?.best ?? 0, days) }) });
};

/** The day streak as it stands on `today`: still running when its last date is today or yesterday, otherwise none. */
export const dayStreakOf = ({ daily }: LocalRecords, today: string): number =>
  daily !== null && (daily.last === today || daily.last === dayBefore(today)) ? daily.days : 0;

/** What records are kept in: the browser's local storage, or a stand-in in tests. */
export type RecordStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's local storage, or null where the browser refuses it, as blocked storage does. */
const browserStore = (): RecordStore | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Tells this tab's readers that the records changed. */
const announce = (): void => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECORDS_EVENT));
};

/** The records as stored, unread; null when there are none or storage can't be read. */
export const storedRecords = (store: RecordStore | null = browserStore()): string | null => {
  try {
    return store?.getItem(RECORDS_KEY) ?? null;
  } catch {
    return null;
  }
};

/**
 * Keeps a finished game in the records and returns them. Where storage refuses it, full or in a private window, the
 * game still played; it just isn't kept.
 */
export const keepGame = (artifact: string, game: FinishedGame, today: string, store: RecordStore | null = browserStore()): LocalRecords => {
  const records = recordGame(parseRecords(storedRecords(store), artifact), game, today);
  try {
    store?.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Not kept.
  }
  announce();
  return records;
};

/** Forgets every record. */
export const clearRecords = (store: RecordStore | null = browserStore()): void => {
  try {
    store?.removeItem(RECORDS_KEY);
  } catch {
    // Storage that can't be reached holds nothing to forget.
  }
  announce();
};
