import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { canonicalBytes } from "./canonical";

/**
 * The run journal keeps every provider response and worker output a run accepted, so a later run can
 * replay them instead of asking the network again.
 *
 * - `fresh` replays nothing and records everything.
 * - `resume` replays deterministic responses (repository, commit, tree, blob, and licence GETs, and
 *   worker outputs) and fetches the rest live: the Hugging Face access check always, and search pages
 *   unless the recorded run finished discovery.
 * - `offline` replays everything and fails with `JOURNAL_MISS` instead of touching the network.
 *
 * The journal lives in a gitignored directory and is never logged. Structured `email` fields are
 * replaced before storage; each entry keeps the hash of the response the run accepted, so a replay
 * reproduces the same crawl snapshot.
 */
export type JournalMode = "fresh" | "resume" | "offline";
/** `fixed` replays in resume and offline, `sequence` replays in order once discovery finished, `offline` replays offline only. */
export type ReplayPolicy = "fixed" | "sequence" | "offline";
/** `failure` records a deterministic provider answer such as a 404, replayed as the same error. */
export type JournalEncoding = "json" | "base64" | "text" | "failure";

export const JOURNAL_SCHEMA = "codeguessr-run-journal.v1";
export const REDACTED_EMAIL = "redacted@journal.invalid";

export class JournalError extends Error {
  public constructor(public readonly code: string) { super(code); this.name = "JournalError"; }
}
const fail = (code: string): never => { throw new JournalError(code); };

export interface JournalEntry {
  readonly key: string;
  readonly policy: ReplayPolicy;
  /** SHA-256 of the bytes the run accepted, which feed the crawl snapshot. */
  readonly sha256: string;
  /** Metered size of the accepted response. */
  readonly byteLength: number;
  readonly encoding: JournalEncoding;
  readonly body: unknown;
  /** SHA-256 of the stored body, checked on every load. */
  readonly storedSha256: string;
}

export interface JournalSummary {
  readonly mode: JournalMode;
  readonly replayed: number;
  readonly live: number;
}

export interface RunJournal {
  readonly mode: JournalMode;
  /** The recorded entry to replay, or `undefined` to go live. Offline, a missing entry throws `JOURNAL_MISS`. */
  take(key: string, policy: ReplayPolicy): JournalEntry | undefined;
  /** Keeps a response the run fetched live and accepted. */
  record(entry: Readonly<{ key: string; policy: ReplayPolicy; sha256: string; byteLength: number; encoding: JournalEncoding; body: unknown }>): void;
  /** Marks discovery finished, so a resumed run may replay this run's search pages. */
  markDiscoveryComplete(): void;
  /** Writes the journal (except offline) and reports what was replayed and fetched. */
  finish(): JournalSummary;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const HEX_64 = /^[0-9a-f]{64}$/u;
const POLICIES = new Set<ReplayPolicy>(["fixed", "sequence", "offline"]);
const ENCODINGS = new Set<JournalEncoding>(["json", "base64", "text", "failure"]);

/** Replaces every string under an `email` key; nothing the preparer reads is stored there. */
export const redactEmails = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactEmails);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === "email" && typeof item === "string" ? REDACTED_EMAIL : redactEmails(item)]));
};

const storedBytes = (encoding: JournalEncoding, body: unknown): Uint8Array =>
  encoding === "json" || encoding === "failure" ? canonicalBytes(body) : new TextEncoder().encode(String(body));

/** Decodes a replayed entry into the value a live request would have returned. */
export const decodeEntry = (entry: JournalEntry): unknown => {
  if (entry.encoding === "json") return structuredClone(entry.body);
  if (entry.encoding === "base64") return new Uint8Array(Buffer.from(String(entry.body), "base64"));
  return String(entry.body);
};

const parseEntry = (value: unknown): JournalEntry => {
  if (typeof value !== "object" || value === null) return fail("JOURNAL_CORRUPT");
  const { key, policy, sha256: accepted, byteLength, encoding, body, storedSha256 } = value as Record<string, unknown>;
  if (typeof key !== "string" || key.length === 0 || !POLICIES.has(policy as ReplayPolicy)
    || typeof accepted !== "string" || !HEX_64.test(accepted) || !Number.isSafeInteger(byteLength) || (byteLength as number) < 0
    || !ENCODINGS.has(encoding as JournalEncoding) || typeof storedSha256 !== "string"
    || ((encoding === "base64" || encoding === "text") && typeof body !== "string")
    || (encoding === "failure" && !Number.isSafeInteger((body as { status?: unknown } | null)?.status))) return fail("JOURNAL_CORRUPT");
  let actual: string;
  try { actual = sha256(storedBytes(encoding as JournalEncoding, body)); } catch { return fail("JOURNAL_CORRUPT"); }
  if (actual !== storedSha256) fail("JOURNAL_CORRUPT");
  return Object.freeze({ key, policy: policy as ReplayPolicy, sha256: accepted, byteLength: byteLength as number,
    encoding: encoding as JournalEncoding, body, storedSha256 });
};

interface LoadedJournal { readonly entries: readonly JournalEntry[]; readonly discoveryComplete: boolean }

const loadJournal = (path: string): LoadedJournal => {
  if (!existsSync(path)) return fail("JOURNAL_MISSING");
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  const parse = (line: string): unknown => { try { return JSON.parse(line); } catch { return fail("JOURNAL_CORRUPT"); } };
  const header = parse(lines[0] ?? "") as Record<string, unknown> | null;
  if (typeof header !== "object" || header === null || header.schema !== JOURNAL_SCHEMA
    || typeof header.discoveryComplete !== "boolean" || header.entries !== lines.length - 1) fail("JOURNAL_CORRUPT");
  return { entries: lines.slice(1).map((line) => parseEntry(parse(line))), discoveryComplete: header!.discoveryComplete as boolean };
};

export const openJournal = (options: Readonly<{ mode: JournalMode; path: string }>): RunJournal => {
  const loaded = options.mode === "fresh" ? { entries: [], discoveryComplete: false } : loadJournal(options.path);
  const fixed = new Map<string, JournalEntry>();
  const sequences = new Map<string, JournalEntry[]>();
  for (const entry of loaded.entries) {
    if (entry.policy === "sequence") {
      if (options.mode === "offline" || loaded.discoveryComplete) sequences.set(entry.key, [...(sequences.get(entry.key) ?? []), entry]);
    } else if (!fixed.has(entry.key) && (entry.policy === "fixed" || options.mode === "offline")) fixed.set(entry.key, entry);
  }
  const cursors = new Map<string, number>();
  const kept: JournalEntry[] = [];
  const consumed = new Set<JournalEntry>();
  let replayed = 0;
  let live = 0;
  let discoveryComplete = false;
  return {
    mode: options.mode,
    take: (key, policy) => {
      let entry: JournalEntry | undefined;
      if (policy === "sequence") {
        const offset = cursors.get(key) ?? 0;
        entry = sequences.get(key)?.[offset];
        if (entry) cursors.set(key, offset + 1);
      } else {
        entry = fixed.get(key);
      }
      if (entry === undefined) {
        if (options.mode === "offline") fail("JOURNAL_MISS");
        return undefined;
      }
      if (!consumed.has(entry)) { consumed.add(entry); kept.push(entry); }
      replayed += 1;
      return entry;
    },
    record: ({ key, policy, sha256: accepted, byteLength, encoding, body }) => {
      if (options.mode === "offline") fail("JOURNAL_OFFLINE_RECORD");
      const stored = encoding === "json" ? redactEmails(body) : body;
      kept.push(Object.freeze({ key, policy, sha256: accepted, byteLength, encoding, body: stored,
        storedSha256: sha256(storedBytes(encoding, stored)) }));
      live += 1;
    },
    markDiscoveryComplete: () => { discoveryComplete = true; },
    finish: () => {
      if (options.mode !== "offline") {
        // Responses this run did not need stay available to the next run. Search pages are kept as one
        // set: this run's if it searched at all, otherwise the recorded run's, with its discovery flag.
        const keys = new Set(kept.map(({ key }) => key));
        const searched = kept.some(({ policy }) => policy === "sequence");
        const carried = loaded.entries.filter((entry) => !consumed.has(entry) && !keys.has(entry.key)
          && (entry.policy !== "sequence" || !searched));
        const entries = [...kept, ...carried];
        const complete = searched ? discoveryComplete : discoveryComplete || loaded.discoveryComplete;
        const lines = [JSON.stringify({ schema: JOURNAL_SCHEMA, discoveryComplete: complete, entries: entries.length }),
          ...entries.map((entry) => JSON.stringify(entry))];
        mkdirSync(dirname(options.path), { recursive: true });
        const temporary = `${options.path}.partial`;
        writeFileSync(temporary, `${lines.join("\n")}\n`, { mode: 0o600 });
        renameSync(temporary, options.path);
      }
      return Object.freeze({ mode: options.mode, replayed, live });
    },
  };
};
