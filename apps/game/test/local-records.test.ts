import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECORDS_KEY,
  RECORDS_VERSION,
  clearRecords,
  dayStreakOf,
  emptyRecords,
  keepGame,
  parseRecords,
  recordDelta,
  recordGame,
  recordsAtStart,
  recordsArtifact,
  storedRecords,
  streakOutlook,
  type FinishedGame,
  type LocalRecords,
  type RecordStore,
} from "../src/components/arcade/local-records";
import { ClearRecords, DayStreak, DeckRecord } from "../src/components/chooser-records";

// Personal records (#63): what the browser keeps, how it reads what it finds, and the streak rules.
const ARTIFACT = recordsArtifact("1abc21f8b819f40e45dc690d63cf89ad2fa1b22355ffdc321d1ac1ffb09b9522");
const OTHER = recordsArtifact("ffffffffffffffff45dc690d63cf89ad2fa1b22355ffdc321d1ac1ffb09b9522");
const TODAY = "2026-10-22";

/** A storage stand-in, as `localStorage` behaves. */
const memoryStore = (): RecordStore & { readonly items: Map<string, string> } => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: (key) => { items.delete(key); },
  };
};
const game = (deck: string, score: number, correct: number, date: string | null = null): FinishedGame => ({ deck, score, correct, date });
const played = (games: readonly FinishedGame[], today = TODAY, from: LocalRecords = emptyRecords(ARTIFACT)): LocalRecords =>
  games.reduce((records, finished) => recordGame(records, finished, today), from);

afterEach(() => { vi.unstubAllGlobals(); });

describe("local records (#63)", () => {
  it("keeps each deck's best, games played, and streak of games with three or more of five right", () => {
    const records = played([game("fix", 3250, 4), game("fix", 2000, 3), game("fix", 4000, 5), game("language", 1500, 2), game("fix", 900, 2), game("fix", 2500, 3)]);
    expect(records.decks).toEqual({
      fix: { best: 4000, played: 5, streak: 1, bestStreak: 3 },
      language: { best: 1500, played: 1, streak: 0, bestStreak: 0 },
    });
    expect(records.daily).toBeNull();
  });

  it("counts today's five once a day, and runs its day streak over consecutive dates", () => {
    let records = played([game("daily", 3000, 4, "2026-10-20")], "2026-10-20");
    expect(records.daily).toEqual({ last: "2026-10-20", days: 1, best: 1 });
    // Playing that date's five again, however it was dealt, changes nothing.
    expect(recordGame(records, game("daily", 5000, 5, "2026-10-20"), "2026-10-20")).toBe(records);
    records = played([game("daily", 2000, 2, "2026-10-21")], "2026-10-21", records);
    expect(records.daily).toEqual({ last: "2026-10-21", days: 2, best: 2 });
    expect(records.decks.daily).toEqual({ best: 3000, played: 2, streak: 0, bestStreak: 1 });
    expect(dayStreakOf(records, "2026-10-21")).toBe(2);
    expect(dayStreakOf(records, "2026-10-22")).toBe(2);
    expect(dayStreakOf(records, "2026-10-23")).toBe(0);
    // A day missed starts the streak again, and keeps the best.
    records = played([game("daily", 1000, 1, "2026-10-23")], "2026-10-23", records);
    expect(records.daily).toEqual({ last: "2026-10-23", days: 1, best: 2 });
    // Across a month's end.
    expect(played([game("daily", 1, 1, "2026-11-01")], "2026-11-01", played([game("daily", 1, 1, "2026-10-31")], "2026-10-31")).daily?.days).toBe(2);
  });

  it("says what a game changed: a new best, a streak of two or more, the day streak, or nothing when it counted for nothing", () => {
    // Earlier games are played on their own dates, the last on `today`.
    const delta = (games: readonly FinishedGame[], today = TODAY) => {
      const before = games.slice(0, -1).reduce((records, finished) => recordGame(records, finished, finished.date ?? today), emptyRecords(ARTIFACT));
      return recordDelta(before, recordGame(before, games.at(-1)!, today), games.at(-1)!, today);
    };
    // A first game sets the best, unless it scored nothing.
    expect(delta([game("fix", 3250, 4)])).toEqual({ newBest: { score: 3250, previous: 0 }, streak: 1, bestStreak: false, dayStreak: null, counted: true });
    expect(delta([game("fix", 0, 0)])).toEqual({ newBest: null, streak: 0, bestStreak: false, dayStreak: null, counted: true });
    // Equal to the best is no new best; the streak carries, and the first longer one is the longest.
    expect(delta([game("fix", 3250, 4), game("fix", 3250, 3)])).toEqual({ newBest: null, streak: 2, bestStreak: true, dayStreak: null, counted: true });
    expect(delta([game("fix", 3250, 4), game("fix", 3250, 3), game("fix", 4000, 5)])).toEqual({ newBest: { score: 4000, previous: 3250 }, streak: 3, bestStreak: true, dayStreak: null, counted: true });
    // A streak equalled is not the longest yet; a miss ends it.
    expect(delta([game("fix", 3250, 4), game("fix", 3250, 3), game("fix", 900, 2), game("fix", 1000, 3), game("fix", 1000, 3)]).bestStreak).toBe(false);
    expect(delta([game("fix", 3250, 4), game("fix", 3250, 3), game("fix", 900, 2)])).toMatchObject({ streak: 0, bestStreak: false });
    // Today's five on the player's date carries its day streak; another day's five, or the same date again, does not.
    expect(delta([game("daily", 2000, 3, "2026-10-21")], "2026-10-21")).toMatchObject({ dayStreak: 1, counted: true });
    expect(delta([game("daily", 2000, 3, "2026-10-21"), game("daily", 2500, 4, "2026-10-22")], "2026-10-22")).toMatchObject({ newBest: { score: 2500, previous: 2000 }, dayStreak: 2 });
    expect(delta([game("daily", 2000, 3, "2026-10-19")], "2026-10-22")).toMatchObject({ dayStreak: null, counted: true });
    expect(delta([game("daily", 2000, 3, TODAY), game("daily", 5000, 5, TODAY)])).toEqual({ newBest: null, streak: 0, bestStreak: false, dayStreak: null, counted: false });
  });

  it("follows a running streak through a game: open with what it still needs, kept at three right, over once three are out of reach (#232)", () => {
    expect(streakOutlook(0, 0, 0, 5)).toEqual({ kind: "none" });
    expect(streakOutlook(2, 0, 0, 5)).toEqual({ kind: "open", streak: 2, need: 3 });
    expect(streakOutlook(2, 1, 2, 5)).toEqual({ kind: "open", streak: 2, need: 2 });
    // One right with two rounds left can still make three; one right with one left can't.
    expect(streakOutlook(2, 1, 3, 5)).toEqual({ kind: "open", streak: 2, need: 2 });
    expect(streakOutlook(2, 2, 3, 5)).toEqual({ kind: "open", streak: 2, need: 1 });
    expect(streakOutlook(2, 1, 4, 5)).toEqual({ kind: "over", streak: 2 });
    expect(streakOutlook(2, 3, 3, 5)).toEqual({ kind: "kept", streak: 2 });
    expect(streakOutlook(1, 3, 5, 5)).toEqual({ kind: "kept", streak: 1 });
    expect(streakOutlook(1, 2, 5, 5)).toEqual({ kind: "over", streak: 1 });
  });

  it("reads the deck's streak and today's five's day streak as a game starts, and nothing without records (#232)", () => {
    const store = memoryStore();
    const kept = played([game("fix", 3250, 4), game("fix", 3000, 3), game("daily", 2000, 3, TODAY)]);
    store.setItem(RECORDS_KEY, JSON.stringify(kept));
    expect(recordsAtStart({ artifact: ARTIFACT, deck: "fix", date: null }, TODAY, store)).toEqual({ streak: 2, dayStreak: 0 });
    expect(recordsAtStart({ artifact: ARTIFACT, deck: "daily", date: TODAY }, TODAY, store)).toEqual({ streak: 1, dayStreak: 1 });
    expect(recordsAtStart({ artifact: ARTIFACT, deck: "language", date: null }, TODAY, store)).toEqual({ streak: 0, dayStreak: 0 });
    // Another round set's records, no records, and no game to record all read as none.
    expect(recordsAtStart({ artifact: OTHER, deck: "fix", date: null }, TODAY, store)).toEqual({ streak: 0, dayStreak: 0 });
    expect(recordsAtStart({ artifact: ARTIFACT, deck: "fix", date: null }, TODAY, memoryStore())).toEqual({ streak: 0, dayStreak: 0 });
    expect(recordsAtStart(undefined, TODAY, store)).toEqual({ streak: 0, dayStreak: 0 });
  });

  it("counts a duel of another day's five toward the deck, not toward the day streak", () => {
    const records = played([game("daily", 3000, 4, "2026-10-19")]);
    expect(records.decks.daily?.played).toBe(1);
    expect(records.daily).toBeNull();
  });

  it("reads back what it keeps, and nothing for another round set, version, or shape", () => {
    const records = played([game("fix", 3250, 4), game("daily", 2000, 3, TODAY)]);
    const stored = JSON.stringify(records);
    expect(parseRecords(stored, ARTIFACT)).toEqual(records);
    expect(parseRecords(stored, OTHER)).toEqual(emptyRecords(OTHER));
    const value = JSON.parse(stored) as Record<string, any>;
    const variants: unknown[] = [
      { ...value, v: RECORDS_VERSION + 1 }, { ...value, extra: 1 }, { ...value, artifact: "1abc" }, { ...value, decks: [] },
      { ...value, decks: { fix: { ...value.decks.fix, best: -1 } } }, { ...value, decks: { fix: { ...value.decks.fix, best: 1.5 } } },
      { ...value, decks: { fix: { ...value.decks.fix, streak: 9 } } }, { ...value, decks: { fix: { ...value.decks.fix, played: 0, bestStreak: 0, streak: 0 } } },
      { ...value, decks: { fix: { ...value.decks.fix, note: "x" } } }, { ...value, decks: { Fix: value.decks.fix } },
      { ...value, decks: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`deck-${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`, value.decks.fix])) },
      { ...value, daily: { last: "22 October", days: 1, best: 1 } }, { ...value, daily: { last: TODAY, days: 0, best: 0 } },
      { ...value, daily: { last: TODAY, days: 3, best: 2 } },
    ];
    for (const variant of variants) expect(parseRecords(JSON.stringify(variant), ARTIFACT), JSON.stringify(variant).slice(0, 120)).toEqual(emptyRecords(ARTIFACT));
    for (const junk of [null, "", "not json", "null", "[]", "{}", "1", "\"records\"", "{\"__proto__\":{\"v\":1}}"]) {
      expect(parseRecords(junk, ARTIFACT), String(junk)).toEqual(emptyRecords(ARTIFACT));
    }
    expect(parseRecords(stored.replace("\"fix\":", "\"__proto__\":"), ARTIFACT)).toEqual(emptyRecords(ARTIFACT));
  });

  it("stores under one key, starts afresh on a new round set, and forgets everything when cleared", () => {
    const store = memoryStore();
    keepGame(ARTIFACT, game("fix", 3250, 4), TODAY, store);
    keepGame(ARTIFACT, game("fix", 1000, 2), TODAY, store);
    expect([...store.items.keys()]).toEqual([RECORDS_KEY]);
    expect(parseRecords(storedRecords(store), ARTIFACT).decks.fix).toEqual({ best: 3250, played: 2, streak: 0, bestStreak: 1 });
    // A new artifact's first game replaces the old round set's records.
    const { records: fresh, delta } = keepGame(OTHER, game("language", 500, 1), TODAY, store);
    expect(delta).toEqual({ newBest: { score: 500, previous: 0 }, streak: 0, bestStreak: false, dayStreak: null, counted: true });
    expect(fresh).toEqual({ v: RECORDS_VERSION, artifact: OTHER, decks: { language: { best: 500, played: 1, streak: 0, bestStreak: 0 } }, daily: null });
    expect(JSON.parse(store.items.get(RECORDS_KEY)!)).toEqual(fresh);
    // Corrupt records are replaced by the next game's.
    store.items.set(RECORDS_KEY, "{oops");
    expect(keepGame(OTHER, game("fix", 700, 3), TODAY, store).records.decks).toEqual({ fix: { best: 700, played: 1, streak: 1, bestStreak: 1 } });
    clearRecords(store);
    expect(store.items.size).toBe(0);
    expect(parseRecords(storedRecords(store), OTHER)).toEqual(emptyRecords(OTHER));
  });

  it("plays on where storage refuses: full, blocked, or missing", () => {
    const refusing = (name: string): RecordStore => ({
      getItem: () => { throw new DOMException("refused", name); },
      setItem: () => { throw new DOMException("refused", name); },
      removeItem: () => { throw new DOMException("refused", name); },
    });
    for (const store of [refusing("QuotaExceededError"), refusing("SecurityError"), null]) {
      expect(storedRecords(store)).toBeNull();
      expect(keepGame(ARTIFACT, game("fix", 3250, 4), TODAY, store).records.decks.fix?.best).toBe(3250);
      expect(() => clearRecords(store)).not.toThrow();
    }
    // A full store still reads what it held.
    const full = { ...memoryStore(), setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
    full.items.set(RECORDS_KEY, JSON.stringify(played([game("fix", 100, 1)])));
    expect(keepGame(ARTIFACT, game("fix", 3250, 4), TODAY, full).records.decks.fix?.best).toBe(3250);
    expect(parseRecords(storedRecords(full), ARTIFACT).decks.fix?.best).toBe(100);
    // A browser whose storage throws on access (blocked site data) plays on with none.
    const events: string[] = [];
    vi.stubGlobal("window", Object.defineProperties({ dispatchEvent: (event: Event) => { events.push(event.type); return true; } }, {
      localStorage: { get: () => { throw new DOMException("blocked", "SecurityError"); } },
    }));
    expect(storedRecords()).toBeNull();
    expect(keepGame(ARTIFACT, game("fix", 3250, 4), TODAY).records.decks.fix?.best).toBe(3250);
    expect(() => clearRecords()).not.toThrow();
    expect(events).toEqual(["codeguessr-records", "codeguessr-records"]);
  });

  it("renders nothing on the server, which never sees the records", () => {
    for (const element of [createElement(DeckRecord, { artifact: ARTIFACT, deck: "fix" }), createElement(DayStreak, { artifact: ARTIFACT }),
      createElement(ClearRecords, { artifact: ARTIFACT })]) {
      expect(renderToStaticMarkup(element)).toBe("");
    }
  });

  it("never reaches the network or the server", () => {
    for (const file of ["components/arcade/local-records.ts", "components/chooser-records.tsx"]) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\bfetch\b|sendBeacon|XMLHttpRequest|WebSocket|sendEvent|\.server"|server-only|actions"/u);
      expect([...source.matchAll(/from "([^"]+)"/gu)].map(([, module]) => module!).filter((module) => !module.startsWith(".")), file)
        .toEqual(file.endsWith(".tsx") ? ["react"] : []);
    }
  });
});
