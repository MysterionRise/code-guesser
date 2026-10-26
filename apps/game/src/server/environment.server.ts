import "server-only";

import { isAbsolute } from "node:path";

import { parseDisabled } from "../experiment/arms";
import { eventSource } from "../experiment/event-store.server";

/**
 * The boot check (#97). `CODEGUESSR_PUBLIC=1` marks a public server, which must be configured for anonymous play
 * before it takes a request; `src/instrumentation.ts` runs this check as the server starts and refuses to start on
 * any code below. Outside public mode nothing more is required than before. Every code names a variable and what is
 * wrong with it, never its value.
 */
export const ENVIRONMENT_CODES = Object.freeze([
  "CODEGUESSR_PUBLIC_INVALID",
  "CODEGUESSR_SESSION_SECRET_MISSING",
  "CODEGUESSR_SESSION_SECRET_TOO_SHORT",
  "CODEGUESSR_PUBLIC_ORIGIN_MISSING",
  "CODEGUESSR_PUBLIC_ORIGIN_INVALID",
  "CODEGUESSR_STATE_DIR_MISSING",
  "CODEGUESSR_STATE_DIR_RELATIVE",
  "EXPERIMENT_EVENTS_DIR_MISSING",
  "EXPERIMENT_EVENTS_DIR_RELATIVE",
  "CODEGUESSR_CLIENT_IP_HEADER_MISSING",
  "CODEGUESSR_CLIENT_IP_HEADER_INVALID",
  "CODEGUESSR_RATE_LIMITS_INVALID",
  "OPENROUTER_API_KEY_MISSING",
  "OPENROUTER_BASE_URL_REJECTED",
  "EXPERIMENT_LAB_REJECTED",
  "EXPERIMENT_DISABLED_UNKNOWN",
] as const);

export type EnvironmentCode = (typeof ENVIRONMENT_CODES)[number];
type Environment = Readonly<Record<string, string | undefined>>;

/** A configured session secret must be at least this long. */
export const MIN_SECRET_LENGTH = 32;
/** The one model address a public server's real games may use; `genui/model.server.ts` defaults to it. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** A header name as a proxy sets it, such as `X-Forwarded-For`. */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/u;

/** Public mode: `CODEGUESSR_PUBLIC=1`. */
export const publicMode = (env: Environment = process.env): boolean => env.CODEGUESSR_PUBLIC === "1";

/**
 * `CODEGUESSR_RATE_LIMITS` (#98) as a multiplier of every rate limit: `on` is 1, and a positive decimal is itself, so a
 * test can tighten the limits and an owner loosen them. Anything else is null.
 */
export const rateLimitMultiplier = (value: string): number | null => {
  if (value === "on") return 1;
  const multiplier = /^\d{1,6}(?:\.\d{1,6})?$/u.test(value) ? Number(value) : 0;
  return multiplier > 0 ? multiplier : null;
};

const present = (value: string | undefined): value is string => value !== undefined && value.length > 0;

/** An https origin exactly as a browser sends it: no path, query, credentials, or trailing slash. */
const isHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
};

/** A directory the server writes to: required, and absolute, so it never lands inside the app. */
const directoryCodes = (value: string | undefined, missing: EnvironmentCode, relative: EnvironmentCode): EnvironmentCode[] =>
  !present(value) ? [missing] : isAbsolute(value) ? [] : [relative];

/**
 * Every reason this environment can't serve, in a fixed order; empty when it can. A smoke run tagged with a non-real
 * `EXPERIMENT_SOURCE` (`agent` or `synthetic`) may also use lab mode and a stand-in model address, since its events
 * never mix with real games.
 */
export const checkEnvironment = (env: Environment): readonly EnvironmentCode[] => {
  if (present(env.CODEGUESSR_PUBLIC) && env.CODEGUESSR_PUBLIC !== "1" && env.CODEGUESSR_PUBLIC !== "0") return ["CODEGUESSR_PUBLIC_INVALID"];
  if (!publicMode(env)) return [];
  const codes: EnvironmentCode[] = [];
  const secret = env.CODEGUESSR_SESSION_SECRET;
  if (secret === undefined) codes.push("CODEGUESSR_SESSION_SECRET_MISSING");
  else if (secret.length < MIN_SECRET_LENGTH) codes.push("CODEGUESSR_SESSION_SECRET_TOO_SHORT");
  const origin = env.CODEGUESSR_PUBLIC_ORIGIN;
  if (!present(origin)) codes.push("CODEGUESSR_PUBLIC_ORIGIN_MISSING");
  else if (!isHttpsOrigin(origin)) codes.push("CODEGUESSR_PUBLIC_ORIGIN_INVALID");
  codes.push(...directoryCodes(env.CODEGUESSR_STATE_DIR, "CODEGUESSR_STATE_DIR_MISSING", "CODEGUESSR_STATE_DIR_RELATIVE"));
  codes.push(...directoryCodes(env.EXPERIMENT_EVENTS_DIR, "EXPERIMENT_EVENTS_DIR_MISSING", "EXPERIMENT_EVENTS_DIR_RELATIVE"));
  const header = env.CODEGUESSR_CLIENT_IP_HEADER;
  if (!present(header)) codes.push("CODEGUESSR_CLIENT_IP_HEADER_MISSING");
  else if (!HEADER_NAME.test(header)) codes.push("CODEGUESSR_CLIENT_IP_HEADER_INVALID");
  const limits = env.CODEGUESSR_RATE_LIMITS;
  if (limits !== undefined && limits !== "" && rateLimitMultiplier(limits) === null) codes.push("CODEGUESSR_RATE_LIMITS_INVALID");
  if (env.GENUI_ENABLED === "1" && !present(env.OPENROUTER_API_KEY)) codes.push("OPENROUTER_API_KEY_MISSING");
  const real = eventSource(env) === "real";
  if (real && env.OPENROUTER_BASE_URL !== undefined && env.OPENROUTER_BASE_URL !== OPENROUTER_BASE_URL) codes.push("OPENROUTER_BASE_URL_REJECTED");
  if (real && env.EXPERIMENT_LAB === "1") codes.push("EXPERIMENT_LAB_REJECTED");
  const named = (env.EXPERIMENT_DISABLED ?? "").split(",").map((pair) => pair.trim()).filter((pair) => pair.length > 0);
  const known = parseDisabled(env.EXPERIMENT_DISABLED);
  if (named.some((pair) => !known.has(pair))) codes.push("EXPERIMENT_DISABLED_UNKNOWN");
  return Object.freeze(codes);
};
