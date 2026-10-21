import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { openSqlite, type Sqlite } from "./sqlite.server";

/**
 * The server's own state on its volume (#164): one SQLite file in `CODEGUESSR_STATE_DIR`, written synchronously, so
 * what a game must remember outlives a restart. It holds no request data, and the event log stays JSON lines (#107).
 */
export interface StateStore {
  /** The latest step recorded for a game, or undefined when the store holds none. */
  ledgerStep(gameId: string): number | undefined;
  /** Records a game's latest step until it expires; a recorded step never moves back. */
  recordLedgerStep(gameId: string, step: number, expiresAt: number, now: number): void;
  /** Deletes every row past its expiry, and returns how many. */
  prune(now: number): number;
  close(): void;
}

export const STATE_FILE = "state.sqlite";
/** Expired rows are deleted when the store opens, then at most this often as steps are recorded. */
export const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * The schema, one migration at a time: each runs once, in order, and is never edited once shipped, and
 * `user_version` counts those applied. A later feature, such as the duel plays (#173), adds its tables as a new one.
 */
export const MIGRATIONS: readonly string[] = Object.freeze([
  `CREATE TABLE ledger (game_id TEXT PRIMARY KEY, step INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
   CREATE INDEX ledger_expiry ON ledger (expires_at);`,
]);

/** Applies the migrations this file has not had yet, in one transaction; a file from a newer build is refused. */
const migrate = (database: Sqlite): void => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const { user_version: applied } = database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (applied > MIGRATIONS.length) throw new Error("STATE_STORE_NEWER");
    for (const migration of MIGRATIONS.slice(applied)) database.exec(migration);
    database.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

/** Opens, migrates, and prunes the store in `directory`, creating both when they don't exist. */
export const openStateStore = (directory: string, now = Date.now()): StateStore => {
  mkdirSync(directory, { recursive: true });
  const database = openSqlite(join(directory, STATE_FILE));
  try {
    migrate(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const select = database.prepare("SELECT step FROM ledger WHERE game_id = ?");
  const upsert = database.prepare(`INSERT INTO ledger (game_id, step, expires_at) VALUES (?, ?, ?)
    ON CONFLICT (game_id) DO UPDATE SET step = excluded.step, expires_at = excluded.expires_at WHERE excluded.step > ledger.step`);
  const expired = database.prepare("DELETE FROM ledger WHERE expires_at < ?");
  let prunedAt = now;
  const prune = (at: number): number => {
    prunedAt = at;
    return Number(expired.run(at).changes);
  };
  prune(now);
  return Object.freeze({
    ledgerStep: (gameId: string) => (select.get(gameId) as { step: number } | undefined)?.step,
    recordLedgerStep: (gameId: string, step: number, expiresAt: number, at: number) => {
      upsert.run(gameId, step, expiresAt);
      if (at - prunedAt >= PRUNE_INTERVAL_MS) prune(at);
    },
    prune,
    close: () => { database.close(); },
  });
};

interface StoreGlobals {
  store?: StateStore | null;
}

// Like the session ledger, the store lives on the process, since Next builds each route into its own bundle.
const shared = (): StoreGlobals => {
  const key = Symbol.for("codeguessr.state-store");
  const holder = globalThis as unknown as Record<symbol, StoreGlobals | undefined>;
  return holder[key] ??= {};
};

/**
 * The process's store, opened once from `CODEGUESSR_STATE_DIR`; null when it is unset, and the game then keeps its
 * ledger in memory only, as before. A store that fails to open throws, and the next call tries again.
 */
export const stateStore = (env: Readonly<Record<string, string | undefined>> = process.env): StateStore | null => {
  const globals = shared();
  if (globals.store !== undefined) return globals.store;
  const directory = env.CODEGUESSR_STATE_DIR;
  globals.store = directory === undefined || directory.length === 0 ? null : openStateStore(directory);
  return globals.store;
};
