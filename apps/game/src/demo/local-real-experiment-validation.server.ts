import "server-only";

import { createHash } from "node:crypto";

import { fail, type JsonRecord } from "./local-real-experiment-domain.server";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_ID = /^[0-9a-f]{40}$/u;

export const isRecord = (value: unknown): value is JsonRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const record = (value: unknown, keys: readonly string[]): JsonRecord => {
  if (!isRecord(value)) return fail();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) return fail();
  return value;
};

export const text = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return fail();
  return value;
};

export const codeText = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) return fail();
  return value;
};

export const sha256 = (value: unknown): string =>
  SHA256.test(text(value)) ? value as string : fail();
export const gitId = (value: unknown): string =>
  GIT_ID.test(text(value)) ? value as string : fail();
export const bool = (value: unknown): boolean =>
  typeof value === "boolean" ? value : fail();
export const positiveInteger = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fail();
export const count = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail();

export const texts = (value: unknown, exactLength?: number): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0
    || (exactLength !== undefined && value.length !== exactLength)) return fail();
  const parsed = value.map(text);
  if (new Set(parsed).size !== parsed.length) return fail();
  return parsed;
};

export const deepFreeze = <Value>(value: Value, seen = new Set<object>()): Value => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as JsonRecord)) deepFreeze(nested, seen);
  return Object.freeze(value);
};

export const serializeCanonical = (value: unknown, active = new Set<object>()): string => {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : fail();
  if (!isRecord(value) && !Array.isArray(value)) return fail();
  if (active.has(value)) return fail();
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) return fail();
      return `[${value.map((entry) => serializeCanonical(entry, active)).join(",")}]`;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return fail();
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${serializeCanonical(value[key], active)}`).join(",")}}`;
  } finally {
    active.delete(value);
  }
};

export const canonicalHash = (value: unknown): string =>
  createHash("sha256").update(serializeCanonical(value)).digest("hex");
export const rawHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const containsProtected = (haystack: string, needle: string): boolean => {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "u").test(haystack);
};
