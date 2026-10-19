import "server-only";

import { canonicalHash } from "../../../../packages/artifact/src/index";
import { fail } from "./local-real-experiment-domain.server";

/**
 * The source of randomness for today's five (#74): seeded by the artifact and the local date, so every load that day
 * deals the same rounds in the same order, and another day or another artifact deals differently.
 */
export const dailyRandom = (artifactHash: string, date: string): (() => number) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail();
  let seed = Number.parseInt(canonicalHash({ artifactHash, date }).slice(0, 8), 16) >>> 0;
  // mulberry32: small, fast, and the same on every machine.
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};
/** A date as the player's machine names it, `YYYY-MM-DD`. */
export const localDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
