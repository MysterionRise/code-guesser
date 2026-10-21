import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { artifact, hashValue } from "./support/local-real-artifact";

const { MIGRATIONS, PRUNE_INTERVAL_MS, STATE_FILE, openStateStore, stateStore } = await import("../src/server/state-store.server");
const { openSqlite } = await import("../src/server/sqlite.server");
const { GAME_TTL_MS, deriveKey } = await import("../src/demo/local-real-experiment-session.server");
const { createLocalRealExperiment } = await import("../src/demo/local-real-experiment.server");

const NOW = 1_800_000_000_000;
const SECRET = "r".repeat(32);
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const create = () => { const value = artifact(); return createLocalRealExperiment(value, hashValue(value)) as any; };
const right = (experiment: any, round: any): string => experiment.privateReveals[round.roundId].correctCandidateId;
const answer = (experiment: any, token: string, round: any, now = NOW) =>
  experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId: right(experiment, round) }, now);
const hint = (experiment: any, token: string, round: any, now = NOW) =>
  experiment.revealHint({ sessionToken: token, roundId: round.roundId }, now);

/** What a restart forgets: the session's secret and in-memory ledger, and the open store. */
const restart = (): void => {
  const holder = globalThis as Record<symbol, any>;
  holder[Symbol.for("codeguessr.state-store")]?.store?.close();
  delete holder[Symbol.for("codeguessr.state-store")];
  delete holder[Symbol.for("codeguessr.game-session")];
};

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "codeguessr-state-"));
  restart();
});
afterEach(() => {
  restart();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("the state store (#164)", () => {
  it("creates its directory and file, and migrates once to the current schema", () => {
    const nested = join(directory, "state", "v1");
    openStateStore(nested, NOW).close();
    const reopened = openStateStore(nested, NOW);
    reopened.close();
    const database = openSqlite(join(nested, STATE_FILE));
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual([{ name: "ledger" }]);
    database.close();
  });

  it("refuses a file a newer build has migrated", () => {
    openStateStore(directory, NOW).close();
    const database = openSqlite(join(directory, STATE_FILE));
    database.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    database.close();
    expect(() => openStateStore(directory, NOW)).toThrow("STATE_STORE_NEWER");
  });

  it("keeps a game's latest step, never moving it back", () => {
    const store = openStateStore(directory, NOW);
    expect(store.ledgerStep("a")).toBeUndefined();
    store.recordLedgerStep("a", 0, NOW + GAME_TTL_MS, NOW);
    store.recordLedgerStep("a", 2, NOW + GAME_TTL_MS, NOW);
    store.recordLedgerStep("a", 1, NOW + GAME_TTL_MS, NOW);
    expect(store.ledgerStep("a")).toBe(2);
    store.close();
  });

  it("prunes expired games when it opens, and then at most every interval", () => {
    const store = openStateStore(directory, NOW);
    store.recordLedgerStep("old", 1, NOW + 10, NOW);
    store.recordLedgerStep("live", 1, NOW + GAME_TTL_MS, NOW);
    store.recordLedgerStep("live", 2, NOW + GAME_TTL_MS, NOW + PRUNE_INTERVAL_MS - 1);
    expect(store.ledgerStep("old")).toBe(1);
    store.recordLedgerStep("live", 3, NOW + GAME_TTL_MS, NOW + PRUNE_INTERVAL_MS);
    expect(store.ledgerStep("old")).toBeUndefined();
    expect(store.ledgerStep("live")).toBe(3);
    store.recordLedgerStep("brief", 0, NOW + PRUNE_INTERVAL_MS + 5, NOW + PRUNE_INTERVAL_MS);
    store.close();
    const reopened = openStateStore(directory, NOW + PRUNE_INTERVAL_MS + 6);
    expect(reopened.ledgerStep("brief")).toBeUndefined();
    expect(reopened.prune(NOW + GAME_TTL_MS + 1)).toBe(1);
    reopened.close();
  });

  it("is off without CODEGUESSR_STATE_DIR, and opened once from it", () => {
    expect(stateStore({})).toBeNull();
    restart();
    const store = stateStore({ CODEGUESSR_STATE_DIR: directory });
    expect(store).not.toBeNull();
    expect(stateStore({ CODEGUESSR_STATE_DIR: directory })).toBe(store);
  });
});

describe("the session ledger across a restart (#164)", () => {
  beforeEach(() => {
    vi.stubEnv("CODEGUESSR_SESSION_SECRET", SECRET);
    vi.stubEnv("CODEGUESSR_STATE_DIR", directory);
  });

  it("refuses an older token after a restart, and continues the game from its latest one", () => {
    const experiment = create();
    const { mode, sessionToken } = experiment.dealGame("project", seeded(6), NOW);
    const bought = hint(experiment, sessionToken, mode.rounds[0]);
    const first = answer(experiment, bought.sessionToken, mode.rounds[0]);
    expect(first.ok).toBe(true);
    restart();
    // The reveal was seen, so neither the dealt token nor the one before the answer may answer the round again.
    expect(answer(experiment, sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
    expect(answer(experiment, bought.sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
    expect(answer(experiment, first.sessionToken, mode.rounds[1]).ok).toBe(true);
  });

  it("ends a game the store never recorded", () => {
    vi.stubEnv("CODEGUESSR_STATE_DIR", "");
    const experiment = create();
    const { mode, sessionToken } = experiment.dealGame("language", seeded(5), NOW);
    restart();
    vi.stubEnv("CODEGUESSR_STATE_DIR", directory);
    expect(answer(experiment, sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "SESSION_ENDED" });
  });

  it("still keeps one answer per round inside one process", () => {
    const experiment = create();
    const { mode, sessionToken } = experiment.dealGame("language", seeded(5), NOW);
    expect(answer(experiment, sessionToken, mode.rounds[0]).ok).toBe(true);
    expect(answer(experiment, sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
  });
});

describe("derived keys (#164)", () => {
  it("derives a stable 32-byte key per context from the session secret", () => {
    vi.stubEnv("CODEGUESSR_SESSION_SECRET", SECRET);
    const duel = deriveKey("codeguessr-duel.v1");
    expect(duel).toHaveLength(32);
    expect(deriveKey("codeguessr-duel.v1").equals(duel)).toBe(true);
    expect(deriveKey("codeguessr-other.v1").equals(duel)).toBe(false);
    expect(duel.equals(Buffer.from(SECRET, "utf8"))).toBe(false);
    restart();
    vi.stubEnv("CODEGUESSR_SESSION_SECRET", "q".repeat(32));
    expect(deriveKey("codeguessr-duel.v1").equals(duel)).toBe(false);
    expect(() => deriveKey("")).toThrow("KEY_CONTEXT_REJECTED");
  });
});
