import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TRUSTED_ARTIFACT_HASH } from "./local-real-experiment.pin.server";
import {
  createLocalRealExperiment,
  type LocalRealExperiment,
} from "./local-real-experiment.server";

/** Permanent notice shown above the experiment; it names both sources and the unreviewed status. */
export const LOCAL_REAL_EXPERIMENT_NOTICE = "Local unreviewed experiment. Real rounds crawled automatically "
  + "from GitHub Search and The Stack v2, ingested without human review, for localhost testing only. "
  + "Not approved beta content.";

/** Resolved against the game package directory, which every documented start command uses as its cwd. */
export const ARTIFACT_RELATIVE_PATH = "src/demo/generated/local-real-rounds.json";

export type LoadedLocalRealExperiment =
  | Readonly<{ ok: true; experiment: LocalRealExperiment }>
  | Readonly<{ ok: false; reason: "ARTIFACT_MISSING" | "ARTIFACT_REJECTED" }>;

export interface LoadOptions {
  readonly artifactPath?: string;
  readonly trustedArtifactHash?: string;
}

/**
 * Reads the generated artifact from disk and binds it to the trusted hash through the
 * existing server-only authority. Nothing here falls back to synthetic rounds: a missing
 * or rejected artifact leaves the root route without any playable round.
 */
export const loadLocalRealExperiment = (options: LoadOptions = {}): LoadedLocalRealExperiment => {
  const artifactPath = options.artifactPath ?? join(process.cwd(), ARTIFACT_RELATIVE_PATH);
  const trustedArtifactHash = options.trustedArtifactHash ?? TRUSTED_ARTIFACT_HASH;
  let text: string;
  try {
    text = readFileSync(artifactPath, "utf8");
  } catch {
    return Object.freeze({ ok: false, reason: "ARTIFACT_MISSING" });
  }
  try {
    const experiment = createLocalRealExperiment(JSON.parse(text), trustedArtifactHash);
    return Object.freeze({ ok: true, experiment });
  } catch {
    return Object.freeze({ ok: false, reason: "ARTIFACT_REJECTED" });
  }
};

let active: LoadedLocalRealExperiment | undefined;

/** The root route's single fixture authority, evaluated once per server process. */
export const activeLocalRealExperiment = (): LoadedLocalRealExperiment => {
  active ??= loadLocalRealExperiment();
  return active;
};
