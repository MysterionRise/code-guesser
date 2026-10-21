import "server-only";

import type { DatabaseSync } from "node:sqlite";

export type Sqlite = DatabaseSync;

type SqliteModule = typeof import("node:sqlite") & { readonly Database?: typeof DatabaseSync };

/** How long a statement waits for another connection's lock before it fails. */
export const BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens a SQLite file with Node's own `node:sqlite` (Node 24, #21), in WAL mode. The module is loaded through
 * `process.getBuiltinModule`, so the bundler never sees an import to resolve, and its class is `Database` from
 * Node 26, which renames `DatabaseSync`.
 */
export const openSqlite = (path: string): Sqlite => {
  const sqlite = process.getBuiltinModule("node:sqlite") as SqliteModule;
  const Database = sqlite.Database ?? sqlite.DatabaseSync;
  const database = new Database(path);
  try {
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    database.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
};
