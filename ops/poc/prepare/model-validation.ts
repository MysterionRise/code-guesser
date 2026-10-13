/** Run records and round records fail exactly as artifact records do. */
export { ExperimentRecordError, fail } from "../../../packages/artifact/src/errors";
import { fail } from "../../../packages/artifact/src/errors";

export type RecordValue = Record<string, unknown>;

export const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const record = (value: unknown, keys: readonly string[]): RecordValue => {
  if (!isRecord(value)) return fail();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
  return value;
};

export const text = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return fail();
  return value;
};

export const codeText = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fail();

export const exact = <T extends string>(value: unknown, expected: T): T =>
  value === expected ? expected : fail();
export const bool = (value: unknown): boolean => typeof value === "boolean" ? value : fail();
export const count = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0
  ? value as number
  : fail();
export const positiveCount = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fail();
export const sha256 = (value: unknown): string => /^[0-9a-f]{64}$/u.test(text(value))
  ? value as string
  : fail();
export const gitId = (value: unknown): string => /^[0-9a-f]{40}$/u.test(text(value))
  ? value as string
  : fail();
export const gitMode = (value: unknown): "100644" | "100755" =>
  value === "100644" || value === "100755" ? value : fail();

const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{6})?Z$/u;
export const validUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return false;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return false;
  const parts = match.slice(1, 7).map(Number);
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() + 1 === parts[1]
    && date.getUTCDate() === parts[2]
    && date.getUTCHours() === parts[3]
    && date.getUTCMinutes() === parts[4]
    && date.getUTCSeconds() === parts[5];
};

export const texts = (value: unknown, allowEmpty = false): readonly string[] => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return fail();
  const parsed = value.map(text);
  if (new Set(parsed).size !== parsed.length) fail();
  return parsed;
};

export const deepFreeze = <T>(value: T, seen = new Set<object>()): T => {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
};
