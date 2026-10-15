import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { CONTROL } = await import("../src/experiment/arms");
const { EVENT_TYPES, dayOf, isDay, parseEvent, viewportBucket } = await import("../src/experiment/events");
const { RAW_RETENTION_DAYS, SERVER_EVENT_TYPES, eventSinkFromEnv, eventSource, fileEventStore, storeSink } = await import("../src/experiment/event-store.server");

const DECKS = ["project", "language", "fix"];
const GAME = "0123456789abcdef0123456789abcdef";
const base = (type: string, day = "2026-10-15") => ({ v: 1, type, game: GAME, day, source: "real", deck: "fix", ...CONTROL });

/** One valid event of every type. */
const VALID: Readonly<Record<string, Record<string, unknown>>> = {
  game_dealt: {},
  game_viewed: { viewport: "phone" },
  hint_revealed: { round: 1, hint: 1, ms: 4_000 },
  round_revealed: { round: 2, correct: true, hints: 1, ms: 30_000 },
  game_completed: { score: 4_300, correct: 4, hints: 2, ms: 300_000 },
  deal_again: { to: "same-deck" },
  result_copied: {},
  genui_call: { round: 3, phase: "after-lock", ok: true, status: 0, calls: 2, tokensIn: 7_000, tokensOut: 900, ms: 6_000 },
  genui_interaction: { round: 3, action: "explain" },
  genui_fallback: { round: 3, reason: "failed" },
};

const directories: string[] = [];
const scratch = (): string => { const directory = mkdtempSync(join(tmpdir(), "codeguessr-events-")); directories.push(directory); return directory; };
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("the event schema (#107)", () => {
  it("names every event type once, and accepts one valid event of each", () => {
    expect(Object.keys(VALID).sort()).toEqual([...EVENT_TYPES].sort());
    for (const [type, fields] of Object.entries(VALID)) expect(parseEvent({ ...base(type), ...fields }, DECKS), type).not.toBeNull();
  });

  it("refuses every field it does not name, so nothing identifying can be stored", () => {
    for (const field of ["ip", "userAgent", "cookie", "playerId", "text", "message", "candidateId", "label", "code", "url"]) {
      expect(parseEvent({ ...base("round_revealed"), ...VALID.round_revealed, [field]: "x" }, DECKS), field).toBeNull();
    }
    // A field the type needs is required too: a viewed game without its viewport is refused.
    expect(parseEvent(base("game_viewed"), DECKS)).toBeNull();
  });

  it("refuses out-of-range and mistyped values", () => {
    const round = { ...base("round_revealed"), ...VALID.round_revealed };
    for (const change of [
      { v: 2 }, { game: "not-a-game" }, { day: "2026-02-30" }, { day: "15/10/2026" }, { source: "bot" }, { deck: "unknown" },
      { design: "shiny" }, { theme: 3 }, { type: "page_view" },
      { round: 0 }, { round: 6 }, { round: 1.5 }, { hints: 3 }, { ms: -1 }, { ms: 86_400_001 }, { correct: "yes" },
    ]) expect(parseEvent({ ...round, ...change }, DECKS), JSON.stringify(change)).toBeNull();
    expect(parseEvent([round], DECKS)).toBeNull();
    expect(parseEvent(null, DECKS)).toBeNull();
  });

  it("records days without times, and viewports as buckets", () => {
    expect(dayOf(Date.parse("2026-10-15T23:59:59Z"))).toBe("2026-10-15");
    expect(isDay("2026-10-15")).toBe(true);
    expect(isDay("2026-13-01")).toBe(false);
    expect([320, 639, 640, 1023, 1024, 2560].map(viewportBucket)).toEqual(["phone", "phone", "tablet", "tablet", "desktop", "desktop"]);
  });

  it("splits events between the server and the browser", () => {
    expect([...SERVER_EVENT_TYPES].sort()).toEqual(["game_completed", "game_dealt", "genui_call", "hint_revealed", "round_revealed"]);
  });
});

describe("the event store (#107)", () => {
  it("appends checked events to one file per day and reads them back by range", () => {
    const directory = scratch();
    const store = fileEventStore(directory, DECKS);
    store.append({ ...base("game_dealt", "2026-10-14") } as never);
    store.append({ ...base("round_revealed", "2026-10-15"), ...VALID.round_revealed } as never);
    expect(() => store.append({ ...base("game_dealt"), ip: "127.0.0.1" } as never)).toThrow("EXPERIMENT_EVENT_REJECTED");
    expect(store.days()).toEqual(["2026-10-14", "2026-10-15"]);
    expect(store.read("2026-10-15", "2026-10-15").map(({ type }) => type)).toEqual(["round_revealed"]);
    expect(store.read("2026-10-01", "2026-10-31")).toHaveLength(2);
    expect(readFileSync(join(directory, "events-2026-10-15.jsonl"), "utf8")).not.toContain("127.0.0.1");
  });

  it(`keeps raw events for ${RAW_RETENTION_DAYS} days, then rolls them up into daily totals and deletes them`, () => {
    const directory = scratch();
    const store = fileEventStore(directory, DECKS);
    const old = "2026-07-01";
    const kept = dayOf(Date.parse("2026-10-15T00:00:00Z") - RAW_RETENTION_DAYS * 86_400_000);
    for (const day of [old, kept]) {
      store.append(base("game_dealt", day) as never);
      store.append({ ...base("round_revealed", day), ...VALID.round_revealed } as never);
      store.append({ ...base("round_revealed", day), ...VALID.round_revealed, correct: false, hints: 2 } as never);
      store.append({ ...base("genui_call", day), ...VALID.genui_call } as never);
      store.append({ ...base("game_dealt", day), design: "host" } as never);
    }
    expect(store.rollUp("2026-10-15")).toEqual([old]);
    expect(store.days()).toEqual([kept]);
    expect(existsSync(join(directory, `events-${old}.jsonl`))).toBe(false);
    const totals = store.totals();
    expect(totals).toHaveLength(2);
    const control = totals.find(({ design }) => design === "off")!;
    expect(control).toMatchObject({ day: old, deck: "fix", source: "real", correct: 1, hints: 3, tokensIn: 7_000, tokensOut: 900 });
    expect(control.counts).toMatchObject({ game_dealt: 1, round_revealed: 2, genui_call: 1, game_completed: 0 });
    expect(totals.find(({ design }) => design === "host")!.counts.game_dealt).toBe(1);
    expect(store.rollUp("2026-10-15")).toEqual([]);
  });

  it("completes a game event with the schema, its day, and the source, and never throws into the game", () => {
    const directory = scratch();
    const store = fileEventStore(directory, DECKS);
    const now = Date.parse("2026-10-15T12:00:00Z");
    const sink = storeSink(store, "agent");
    sink({ type: "hint_revealed", game: GAME, deck: "fix", arms: CONTROL, fields: VALID.hint_revealed as never }, now);
    expect(store.read("2026-10-15", "2026-10-15")).toEqual([{ ...base("hint_revealed"), source: "agent", ...VALID.hint_revealed }]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sink({ type: "hint_revealed", game: GAME, deck: "fix", arms: CONTROL, fields: { round: 9, hint: 1, ms: 1 } }, now);
    sink({ type: "game_dealt", game: "short", deck: "fix", arms: CONTROL, fields: {} }, now);
    expect(logged.mock.calls.map(([line]) => line)).toEqual(["EXPERIMENT_EVENT_FAILED EXPERIMENT_EVENT_REJECTED", "EXPERIMENT_EVENT_FAILED EXPERIMENT_EVENT_REJECTED"]);
    logged.mockRestore();
    expect(store.read("2026-10-15", "2026-10-15")).toHaveLength(1);
  });

  it("records nothing unless a directory is configured, and tags playtests by source", () => {
    expect(eventSinkFromEnv(DECKS, {})).toBeNull();
    expect(eventSinkFromEnv(DECKS, { EXPERIMENT_EVENTS_DIR: "" })).toBeNull();
    expect(eventSinkFromEnv(DECKS, { EXPERIMENT_EVENTS_DIR: scratch() })).toBeTypeOf("function");
    expect(eventSource({ EXPERIMENT_SOURCE: "agent" })).toBe("agent");
    expect(eventSource({ EXPERIMENT_SOURCE: "admin" })).toBe("real");
    expect(eventSource({})).toBe("real");
  });
});
