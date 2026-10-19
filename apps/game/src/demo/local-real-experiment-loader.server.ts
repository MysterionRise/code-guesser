import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eventSinkFromEnv, type EventSink } from "../experiment/event-store.server";
import { DECK_IDS } from "./local-real-experiment-domain.server";
import { loadQuestionLayers, type LayerLoadOptions } from "./local-real-experiment-layers.server";
import { TRUSTED_ARTIFACT_HASH } from "./local-real-experiment.pin.server";
import {
  LocalRealExperimentError,
  createLocalRealExperiment,
  type LocalRealExperiment,
} from "./local-real-experiment.server";

/** The permanent notice's bold lead. */
export const LOCAL_REAL_EXPERIMENT_NOTICE_LEAD = "Local unreviewed experiment.";
/** The rest of the notice: every source a deck's rounds come from, localhost only, and not beta content. */
export const LOCAL_REAL_EXPERIMENT_NOTICE_BODY = "Rounds from The Stack v2, GitHub, TheAlgorithms, Defects4J, BugsInPy, TodoMVC, "
  + "and Exercism, for localhost only. Not approved beta content.";
/** Permanent notice shown above the experiment; short enough to wrap to five lines on a 320 px screen. */
export const LOCAL_REAL_EXPERIMENT_NOTICE = `${LOCAL_REAL_EXPERIMENT_NOTICE_LEAD} ${LOCAL_REAL_EXPERIMENT_NOTICE_BODY}`;

/** Resolved against the game package directory, which every documented start command uses as its cwd. */
export const ARTIFACT_RELATIVE_PATH = "src/demo/generated/local-real-rounds.json";

/**
 * Why the root route has no rounds: no readable artifact file, an artifact that does not match the hash pinned
 * in this build, or one that matches its pin but is not valid JSON of the current format.
 */
export type LocalRealExperimentUnavailable = "MISSING" | "HASH_MISMATCH" | "SCHEMA";

export type LoadedLocalRealExperiment =
  | Readonly<{ ok: true; experiment: LocalRealExperiment }>
  | Readonly<{ ok: false; reason: LocalRealExperimentUnavailable }>;

export interface LoadOptions {
  readonly artifactPath?: string;
  readonly trustedArtifactHash?: string;
  /** Where game events go (#107); none records nothing. */
  readonly events?: EventSink | null;
  /** Where the question layers are (#127); the committed file and its pin when unset. */
  readonly layers?: LayerLoadOptions;
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
    return Object.freeze({ ok: false, reason: "MISSING" });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return Object.freeze({ ok: false, reason: "SCHEMA" });
  }
  try {
    const experiment = createLocalRealExperiment(value, trustedArtifactHash,
      { events: options.events ?? null, layers: loadQuestionLayers(value, options.layers) });
    return Object.freeze({ ok: true, experiment });
  } catch (error) {
    const reason = error instanceof LocalRealExperimentError && error.reason === "HASH_MISMATCH" ? "HASH_MISMATCH" : "SCHEMA";
    return Object.freeze({ ok: false, reason });
  }
};

let active: LoadedLocalRealExperiment | undefined;

/**
 * The root route's single fixture authority, evaluated once per server process: a prepared artifact or a new pin
 * takes a rebuild and restart. When it has no rounds, it logs the reason code once, and nothing from the artifact.
 */
export const activeLocalRealExperiment = (): LoadedLocalRealExperiment => {
  if (active === undefined) {
    active = loadLocalRealExperiment({ events: eventSinkFromEnv(DECK_IDS) });
    if (!active.ok) console.error(`LOCAL_REAL_EXPERIMENT_UNAVAILABLE ${active.reason}`);
  }
  return active;
};
