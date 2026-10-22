import "server-only";

import { publicMode, rateLimitMultiplier } from "./environment.server";

/**
 * Rate limits (#98): a token bucket per client key (`client-key.server.ts`) on each surface a player can spend, so one
 * script can't deal games without end, flood the event log, or use up the OpenRouter key's spend limit and with it
 * generative UI for everyone. A bucket holds `burst` tokens and refills at `perMinute`; each request takes one, and
 * is refused while none is left. The buckets live on the process, like the session ledger, so they assume the one
 * instance a public server runs (#100); a full bucket is forgotten, since a fresh one is the same.
 */
export interface Surface {
  readonly perMinute: number;
  readonly burst: number;
  /** One bucket for every client: the whole server's allowance rather than one client's. */
  readonly global?: true;
}

export type SurfaceName = "deal" | "hint" | "reveal" | "beacon" | "genui" | "genui-all" | "og" | "duel_create" | "duel_open";

export const SURFACES: Readonly<Record<SurfaceName, Surface>> = Object.freeze({
  /** A deck's address: a dealt game, or the redirect to a fresh seed's first game. */
  deal: { perMinute: 20, burst: 10 },
  hint: { perMinute: 60, burst: 60 },
  reveal: { perMinute: 60, burst: 60 },
  /** The event log's beacon (#107); each game may also send at most 60 events (`CLIENT_EVENTS_PER_GAME`). */
  beacon: { perMinute: 120, burst: 120 },
  /** Generative UI (#101): every request spends from the OpenRouter key. */
  genui: { perMinute: 10, burst: 4 },
  "genui-all": { perMinute: 120, burst: 120, global: true },
  /** Link previews (#171). Each deck's is drawn at build time and spends nothing; one drawn per request will. */
  og: { perMinute: 120, burst: 60 },
  /** Duel links (#173), declared ahead of them. */
  duel_create: { perMinute: 10, burst: 5 },
  duel_open: { perMinute: 30, burst: 10 },
});

/**
 * Generative calls one game may make, whatever its client's buckets hold: explainer panels (a retry included) over
 * the whole game, and host turns in each round. They bound what a single dealt game can spend.
 */
export const GENUI_CAPS = Object.freeze({ explainer: 12, host: 8 });

/**
 * Buckets, and game counts, the process remembers; past this the least recently used are forgotten, which only
 * refills them early.
 */
export const BUCKET_CAPACITY = 100_000;
/** How often full buckets and expired game counts are swept out. */
const SWEEP_MS = 60_000;
const MINUTE_MS = 60_000;

interface Bucket {
  readonly tokens: number;
  readonly at: number;
  /** When the bucket is full again, and no different from a fresh one. */
  readonly fullAt: number;
}

interface LimitGlobals {
  buckets?: Map<string, Bucket>;
  counts?: Map<string, { count: number; expiresAt: number }>;
  sweptAt?: number;
}

// Next builds each route into its own bundle, so the buckets live on the process instead of in this module.
const shared = (): LimitGlobals => {
  const key = Symbol.for("codeguessr.rate-limits");
  const holder = globalThis as unknown as Record<symbol, LimitGlobals | undefined>;
  return holder[key] ??= {};
};

/**
 * What every limit is multiplied by, or null where limits don't apply. They apply in public mode, and wherever
 * `CODEGUESSR_RATE_LIMITS` is set (`on`, or a multiplier); a setting the boot check would refuse counts as `on`.
 * Playtests and demo recording on loopback set neither, so they are never throttled.
 */
export const rateLimitScale = (env: Readonly<Record<string, string | undefined>> = process.env): number | null => {
  const setting = env.CODEGUESSR_RATE_LIMITS;
  if (setting === undefined || setting === "") return publicMode(env) ? 1 : null;
  return rateLimitMultiplier(setting) ?? 1;
};

const sweep = (globals: LimitGlobals, now: number): void => {
  if (globals.sweptAt !== undefined && now - globals.sweptAt < SWEEP_MS) return;
  globals.sweptAt = now;
  for (const [id, bucket] of globals.buckets ?? []) if (bucket.fullAt <= now) globals.buckets!.delete(id);
  for (const [id, entry] of globals.counts ?? []) if (entry.expiresAt < now) globals.counts!.delete(id);
};

/**
 * Whether a request on `surface` from the client `key` must be refused; one that may go ahead takes a token. A global
 * surface keeps one bucket and ignores the key. Where limits don't apply, nothing is ever refused or counted.
 */
export const limited = (surface: SurfaceName, key: string, now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env): boolean => {
  const scale = rateLimitScale(env);
  if (scale === null) return false;
  const globals = shared();
  sweep(globals, now);
  const buckets = globals.buckets ??= new Map();
  const { perMinute, burst, global } = SURFACES[surface];
  const capacity = Math.max(1, Math.floor(burst * scale));
  const perMinuteScaled = perMinute * scale;
  const id = `${surface}:${global ? "*" : key}`;
  const bucket = buckets.get(id);
  const held = bucket === undefined ? capacity
    : Math.min(capacity, bucket.tokens + (Math.max(0, now - bucket.at) * perMinuteScaled) / MINUTE_MS);
  // A refused request takes nothing and leaves the bucket as it was; it is taken out and put back either way, so the
  // map stays in order of last use and the oldest are forgotten first.
  const next = held < 1 ? bucket! : { tokens: held - 1, at: now, fullAt: now + ((capacity - held + 1) * MINUTE_MS) / perMinuteScaled };
  buckets.delete(id);
  buckets.set(id, next);
  for (const oldest of buckets.keys()) {
    if (buckets.size <= BUCKET_CAPACITY) break;
    buckets.delete(oldest);
  }
  return held < 1;
};

/** Seconds until a refused client on `surface` has a token again, at least one. */
export const retryAfter = (surface: SurfaceName, env: Readonly<Record<string, string | undefined>> = process.env): number =>
  Math.max(1, Math.ceil(60 / (SURFACES[surface].perMinute * (rateLimitScale(env) ?? 1))));

/** A limited request's answer: 429, a stable code, and when to try again, saying nothing about the client. */
export const tooMany = (surface: SurfaceName, env: Readonly<Record<string, string | undefined>> = process.env): Response =>
  Response.json({ reason: "RATE_LIMITED" }, {
    status: 429,
    headers: { "cache-control": "no-store", "retry-after": String(retryAfter(surface, env)) },
  });

/**
 * Counts one generative call against a game's cap (`GENUI_CAPS`) and says whether the cap was already spent. `scope`
 * names what the cap covers, a game or one round of it, by the game's random id; the count is forgotten once the game
 * expires. Like the buckets, caps apply only where limits do.
 */
export const capped = (
  cap: keyof typeof GENUI_CAPS,
  scope: string,
  expiresAt: number,
  now = Date.now(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean => {
  if (rateLimitScale(env) === null) return false;
  const globals = shared();
  sweep(globals, now);
  const counts = globals.counts ??= new Map();
  const id = `${cap}:${scope}`;
  const count = counts.get(id)?.count ?? 0;
  if (count >= GENUI_CAPS[cap]) return true;
  counts.delete(id);
  counts.set(id, { count: count + 1, expiresAt });
  for (const oldest of counts.keys()) {
    if (counts.size <= BUCKET_CAPACITY) break;
    counts.delete(oldest);
  }
  return false;
};
