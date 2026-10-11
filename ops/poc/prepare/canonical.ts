export class CanonicalValueError extends Error {
  public constructor() {
    super("CANONICAL_VALUE_REJECTED");
    this.name = "CanonicalValueError";
  }
}

const fail = (): never => { throw new CanonicalValueError(); };
const encode = new TextEncoder();

/** The game's serializer, so the preparer and the game hash the same bytes. */
const serialize = (value: unknown): string => {
  try {
    return serializeCanonical(value);
  } catch {
    return fail();
  }
};

const FORBIDDEN_ARTIFACT_FIELDS = new Set([
  "executionId", "observedAt", "counters", "diagnostics", "retryState", "waits",
]);

const enforceArtifactBoundary = (value: unknown, seen = new Set<object>()): void => {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_ARTIFACT_FIELDS.has(key)) fail();
    enforceArtifactBoundary(nested, seen);
  }
};

export const canonicalBytes = (value: unknown): Uint8Array => encode.encode(serialize(value));

export const canonicalHash = (value: unknown): string =>
  createHash("sha256").update(canonicalBytes(value)).digest("hex");

export const canonicalArtifactBytes = (value: unknown): Uint8Array => {
  enforceArtifactBoundary(value);
  return canonicalBytes(value);
};

export const canonicalArtifactHash = (value: unknown): string =>
  createHash("sha256").update(canonicalArtifactBytes(value)).digest("hex");
import { createHash } from "node:crypto";

import { serializeCanonical } from "../../../packages/artifact/src/validation";
