import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectPreparationEnvironment, type PreparationDependencies } from "../index";
import { parseCrawlProfile, type CrawlProfile } from "../profile";
import {
  createCapturedDependencies,
  type CapturedDependencyState,
  type CapturedFailure,
} from "./captured-dependencies";
import { createCapturedResponses } from "./captured-responses";
import {
  CAPTURED_AWS_PROFILE,
  CAPTURED_GITHUB_TOKEN,
  CAPTURED_HF_TOKEN,
  CAPTURED_SENSITIVE_CANARIES,
} from "./captured-values";

export type { CapturedFailure } from "./captured-dependencies";

export interface CapturedHarness {
  readonly dependencies: PreparationDependencies;
  readonly events: readonly string[];
  readonly logs: readonly string[];
  readonly reports: readonly Uint8Array[];
  readonly requests: readonly string[];
  readonly metadataConfigurations: readonly string[];
  readonly selectedBlobRows: readonly string[];
  readonly sensitiveCanaries: readonly string[];
  readonly initialArtifact: Uint8Array;
  cleanupCount(): number;
  readArtifact(): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

interface HarnessOptions {
  readonly observedAt: string;
  readonly executionId: string;
  readonly failure?: CapturedFailure;
  readonly providerIncompleteQueryId?: string;
}

const PROFILE_URL = new URL("../../profiles/local-real-rounds.v2.json", import.meta.url);
const REVISION = "e565caa3a78c2423bd374333a472b049eb090e47";

const loadProfile = async (failure?: CapturedFailure): Promise<CrawlProfile> => {
  const raw = JSON.parse(await readFile(PROFILE_URL, "utf8")) as Record<string, any>;
  if (failure === "capacity") raw.capacity.blobAttempts = 1;
  return parseCrawlProfile(raw);
};

const capturedEnvironment = (directory: string, failure?: CapturedFailure) =>
  projectPreparationEnvironment({
    PATH: "/usr/bin", HOME: directory,
    ...(failure === "credential" ? {} : { HF_TOKEN: CAPTURED_HF_TOKEN }),
    GITHUB_TOKEN: CAPTURED_GITHUB_TOKEN, AWS_PROFILE: CAPTURED_AWS_PROFILE,
    STACK_V2_ACKNOWLEDGED_USABLE_REVISION: REVISION,
  });

const createState = async (options: HarnessOptions): Promise<Readonly<{
  state: CapturedDependencyState; directory: string; initialArtifact: Uint8Array;
}>> => {
  const profile = await loadProfile(options.failure);
  const directory = await mkdtemp(join(tmpdir(), "codeguessr-captured-run-"));
  const artifactPath = join(directory, "active-artifact.json");
  const initialArtifact = Buffer.from('{"lastValid":"captured-sentinel"}');
  await writeFile(artifactPath, initialArtifact);
  const state: CapturedDependencyState = {
    profile, captures: createCapturedResponses(profile, options.providerIncompleteQueryId), artifactPath,
    environment: capturedEnvironment(directory, options.failure),
    observedAt: options.observedAt, executionId: options.executionId,
    ...(options.failure ? { failure: options.failure } : {}),
    events: [], logs: [], reports: [], requests: [], metadataConfigurations: [], selectedBlobRows: [], cleanups: 0,
  };
  return Object.freeze({ state, directory, initialArtifact: new Uint8Array(initialArtifact) });
};

export const createCapturedHarness = async (options: HarnessOptions): Promise<CapturedHarness> => {
  const { state, directory, initialArtifact } = await createState(options);
  const dependencies = createCapturedDependencies(state);
  return Object.freeze({
    dependencies, events: state.events, logs: state.logs, reports: state.reports, requests: state.requests,
    metadataConfigurations: state.metadataConfigurations, selectedBlobRows: state.selectedBlobRows,
    sensitiveCanaries: CAPTURED_SENSITIVE_CANARIES, initialArtifact,
    cleanupCount: () => state.cleanups,
    readArtifact: () => readFile(state.artifactPath),
    dispose: () => rm(directory, { recursive: true, force: true }),
  });
};
