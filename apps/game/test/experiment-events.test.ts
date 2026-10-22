import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { CONTROL } = await import("../src/experiment/arms");
const { CLIENT_EVENT_TYPES, EVENT_SCHEMA_VERSION, EVENT_TYPES, RETIRED_EVENT_TYPES, dayOf, isDay, parseEvent, viewportBucket } = await import("../src/experiment/events");
const { RAW_RETENTION_DAYS, SERVER_EVENT_TYPES, eventSinkFromEnv, eventSource, fileEventStore, storeSink } = await import("../src/experiment/event-store.server");

const DECKS = ["project", "language", "fix"];
const GAME = "0123456789abcdef0123456789abcdef";
const base = (type: string, day = "2026-10-15", origin = "deal") => ({ v: 2, type, game: GAME, day, source: "real", origin, deck: "fix", ...CONTROL });
/** A line as schema v1 stored it, with no origin. */
const v1 = (type: string, day = "2026-10-15") => ({ v: 1, type, game: GAME, day, source: "real", deck: "fix", ...CONTROL });

/** One valid event of every type version 2 stores. */
const VALID: Readonly<Record<string, Record<string, unknown>>> = {
  game_dealt: {},
  game_viewed: { viewport: "phone" },
  hint_revealed: { round: 1, hint: 1, ms: 4_000 },
  round_revealed: { round: 2, correct: true, hints: 1, ms: 30_000 },
  game_completed: { score: 4_300, correct: 4, hints: 2, ms: 300_000 },
  deal_again: { to: "same-deck" },
  result_shared: { via: "share" },
  genui_call: { round: 3, phase: "after-lock", ok: true, status: 0, calls: 2, tokensIn: 7_000, tokensOut: 900, ms: 6_000 },
  genui_interaction: { round: 3, action: "explain" },
  genui_fallback: { round: 3, reason: "failed" },
  duel_created: { firstPlay: "yes" },
  duel_completed: { outcome: "won", decidedBy: "hints" },
  duel_link_copied: { link: "challenge", via: "clipboard" },
};

const directories: string[] = [];
const scratch = (): string => { const directory = mkdtempSync(join(tmpdir(), "codeguessr-events-")); directories.push(directory); return directory; };
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("the event schema (#107)", () => {
  it("names every event type once, and accepts one valid event of each", () => {
    expect(EVENT_SCHEMA_VERSION).toBe(2);
    expect(Object.keys(VALID).sort()).toEqual(EVENT_TYPES.filter((type) => !(RETIRED_EVENT_TYPES as readonly string[]).includes(type)).sort());
    for (const [type, fields] of Object.entries(VALID)) {
      for (const origin of ["deal", "duel"]) expect(parseEvent({ ...base(type, undefined, origin), ...fields }, DECKS), `${type} ${origin}`).not.toBeNull();
    }
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
      { v: 3 }, { v: "2" }, { game: "not-a-game" }, { day: "2026-02-30" }, { day: "15/10/2026" }, { source: "bot" }, { origin: "friend" },
      { origin: undefined }, { deck: "unknown" }, { design: "shiny" }, { theme: 3 }, { type: "page_view" },
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
    expect([...SERVER_EVENT_TYPES].sort()).toEqual(["duel_completed", "duel_created", "game_completed", "game_dealt", "genui_call", "hint_revealed",
      "round_revealed"]);
    expect([...CLIENT_EVENT_TYPES].sort()).toEqual(["deal_again", "duel_link_copied", "game_viewed", "genui_fallback", "genui_interaction", "result_shared"]);
  });

  it("says how a result was shared, as a closed choice, and still reads the copies version 1 stored before it (#171)", () => {
    expect(RETIRED_EVENT_TYPES).toEqual(["result_copied"]);
    expect(parseEvent({ ...base("result_shared"), via: "clipboard" }, DECKS)).not.toBeNull();
    for (const via of ["sms", "", 1, null]) expect(parseEvent({ ...base("result_shared"), via }, DECKS), String(via)).toBeNull();
    expect(parseEvent(base("result_shared"), DECKS)).toBeNull();
    expect(parseEvent({ ...base("result_shared"), via: "share", url: "http://127.0.0.1:3000/?deck=fix" }, DECKS)).toBeNull();
    expect(parseEvent(v1("result_copied"), DECKS)).not.toBeNull();
    expect(parseEvent(base("result_copied"), DECKS)).toBeNull();
  });

  it("names a panel that a rate limit or a game's cap turned away (#98), in both versions", () => {
    for (const reason of ["unavailable", "refused", "failed", "rejected", "limited"]) {
      expect(parseEvent({ ...base("genui_fallback"), round: 2, reason }, DECKS), reason).not.toBeNull();
      expect(parseEvent({ ...v1("genui_fallback"), round: 2, reason }, DECKS), reason).not.toBeNull();
    }
    expect(parseEvent({ ...base("genui_fallback"), round: 2, reason: "RATE_LIMITED" }, DECKS)).toBeNull();
  });

  it("reads a version 1 line as a deal's, and only as version 1 stored it (#173)", () => {
    expect(parseEvent({ ...v1("round_revealed"), ...VALID.round_revealed }, DECKS)).toEqual({ ...v1("round_revealed"), ...VALID.round_revealed, origin: "deal" });
    expect(parseEvent({ ...v1("deal_again"), to: "chooser" }, DECKS)).toMatchObject({ v: 1, origin: "deal", to: "chooser" });
    // Version 1 had no origin, no duel events, and no rematch.
    expect(parseEvent({ ...v1("game_dealt"), origin: "deal" }, DECKS)).toBeNull();
    expect(parseEvent({ ...v1("deal_again"), to: "rematch" }, DECKS)).toBeNull();
    for (const type of ["duel_created", "duel_completed", "duel_link_copied"]) expect(parseEvent({ ...v1(type), ...VALID[type] }, DECKS), type).toBeNull();
  });

  it("holds the duel events to closed choices that name no challenge, link, player, or score (#173)", () => {
    expect(parseEvent({ ...base("deal_again", undefined, "duel"), to: "rematch" }, DECKS)).not.toBeNull();
    for (const [type, fields] of [
      ["duel_created", { firstPlay: "maybe" }], ["duel_created", { firstPlay: "yes", challenge: "0".repeat(32) }],
      ["duel_completed", { outcome: "lost", decidedBy: "luck" }], ["duel_completed", { outcome: "won", decidedBy: "score", theirScore: 3_800 }],
      ["duel_completed", { outcome: "won" }], ["duel_link_copied", { link: "challenge", via: "clipboard", token: "abc" }],
      ["duel_link_copied", { link: "challenge", via: "clipboard", name: "Ana" }], ["duel_link_copied", { link: "rematch", via: "share" }],
    ] as const) expect(parseEvent({ ...base(type, undefined, "duel"), ...fields }, DECKS), JSON.stringify(fields)).toBeNull();
  });
});

describe("the event store (#107)", () => {
  it("appends checked events to one file per day and reads them back by range", () => {
    const directory = scratch();
    const store = fileEventStore(directory, DECKS);
    store.append({ ...base("game_dealt", "2026-10-14") } as never);
    store.append({ ...base("round_revealed", "2026-10-15"), ...VALID.round_revealed } as never);
    expect(() => store.append({ ...base("game_dealt"), ip: "127.0.0.1" } as never)).toThrow("EXPERIMENT_EVENT_REJECTED");
    // It reads version 1 but writes only version 2.
    expect(() => store.append(v1("game_dealt") as never)).toThrow("EXPERIMENT_EVENT_REJECTED");
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

  it("rolls up a version 1 day as a deal's, beside a duel's game, and reads the totals version 1 rolled up (#173)", () => {
    const directory = scratch();
    const store = fileEventStore(directory, DECKS);
    // A total as version 1 rolled it up: no origin, and none of version 2's events.
    const v1Counts = { game_dealt: 1, game_viewed: 0, hint_revealed: 0, round_revealed: 0, game_completed: 0, deal_again: 0, result_copied: 0, result_shared: 0,
      genui_call: 0, genui_interaction: 0, genui_fallback: 0 };
    writeFileSync(join(directory, "totals.jsonl"), `${JSON.stringify({ v: 1, day: "2026-06-01", source: "real", deck: "fix", ...CONTROL, counts: v1Counts,
      correct: 0, hints: 0, tokensIn: 0, tokensOut: 0 })}\n`);
    const day = "2026-07-01";
    writeFileSync(join(directory, `events-${day}.jsonl`), `${[v1("game_dealt", day), { ...v1("result_copied", day), game: "f".repeat(32) }]
      .map((line) => JSON.stringify(line)).join("\n")}\n`);
    store.append({ ...base("game_dealt", day, "duel"), game: "e".repeat(32) } as never);
    store.append({ ...base("duel_completed", day, "duel"), game: "e".repeat(32), ...VALID.duel_completed } as never);
    expect(store.read(day, day).map(({ v, origin, type }) => [v, origin, type])).toEqual([[1, "deal", "game_dealt"], [1, "deal", "result_copied"],
      [2, "duel", "game_dealt"], [2, "duel", "duel_completed"]]);
    expect(store.rollUp("2026-10-15")).toEqual([day]);
    const totals = store.totals();
    expect(totals.map(({ v, day: own, origin }) => [v, own, origin])).toEqual([[1, "2026-06-01", "deal"], [2, day, "deal"], [2, day, "duel"]]);
    expect(totals[0]!.counts).toMatchObject({ game_dealt: 1, duel_created: 0, duel_completed: 0, duel_link_copied: 0 });
    expect(totals[1]!.counts).toMatchObject({ game_dealt: 1, result_copied: 1, duel_completed: 0 });
    expect(totals[2]!.counts).toMatchObject({ game_dealt: 1, duel_completed: 1 });
  });

  it("completes a game event with the schema, its day, and the source, and never throws into the game", () => {
    const directory = scratch();
    const store = fileEventStore(directory, DECKS);
    const now = Date.parse("2026-10-15T12:00:00Z");
    const sink = storeSink(store, "agent");
    sink({ type: "hint_revealed", game: GAME, origin: "deal", deck: "fix", arms: CONTROL, fields: VALID.hint_revealed as never }, now);
    sink({ type: "duel_completed", game: GAME, origin: "duel", deck: "fix", arms: CONTROL, fields: VALID.duel_completed as never }, now);
    expect(store.read("2026-10-15", "2026-10-15")).toEqual([{ ...base("hint_revealed"), source: "agent", ...VALID.hint_revealed },
      { ...base("duel_completed", undefined, "duel"), source: "agent", ...VALID.duel_completed }]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sink({ type: "hint_revealed", game: GAME, origin: "deal", deck: "fix", arms: CONTROL, fields: { round: 9, hint: 1, ms: 1 } }, now);
    sink({ type: "game_dealt", game: "short", origin: "deal", deck: "fix", arms: CONTROL, fields: {} }, now);
    // The retired copy is read from version 1's lines, never written again.
    sink({ type: "result_copied", game: GAME, origin: "deal", deck: "fix", arms: CONTROL, fields: {} }, now);
    expect(logged.mock.calls.map(([line]) => line)).toEqual(Array(3).fill("EXPERIMENT_EVENT_FAILED EXPERIMENT_EVENT_REJECTED"));
    logged.mockRestore();
    expect(store.read("2026-10-15", "2026-10-15")).toHaveLength(2);
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
