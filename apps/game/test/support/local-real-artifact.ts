/**
 * Builds one schema-valid in-memory v2 local-experiment artifact for tests by running the
 * operator composer on its own deterministic test candidates. The game authority must accept
 * exactly what the preparer produces, so the tests share one source of truth for the shape.
 */
import { createHash } from "node:crypto";

import { composeExperimentArtifact } from "../../../../ops/poc/prepare/compose";
import { composeInput } from "../../../../ops/poc/prepare/testdata/v2-builders";

export const canonical = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};
export const hashValue = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
export const hash = (digit: string): string => digit.repeat(64);

const composed = composeExperimentArtifact(composeInput());

/** The operator's own hash for the composed artifact; the game must agree with it. */
export const COMPOSED_ARTIFACT_HASH = composed.artifactHash;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const artifact = (): any => structuredClone(composed.artifact);

/** The correct candidate for a fixture, resolved on the Node side as a test oracle. */
export const correctLabel = (fixture: { candidates: { id: string; label: string }[]; correctCandidateId: string }): string =>
  fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
