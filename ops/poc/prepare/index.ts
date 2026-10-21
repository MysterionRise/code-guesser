import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PROFILE_VERSIONS } from "../../../packages/artifact/src/index";
import { defaultDependencies, type DependencyOptions } from "./dependencies";
import { PreparationError } from "./diagnostics";
import type { JournalMode } from "./journal";
import { prepareLocalExperiment } from "./pipeline";
import type { PreparationResult } from "./types";

export { projectBlobWorkerEnvironment } from "./blob-worker";
export { projectPreparationEnvironment } from "./dependencies";
export { PreparationError } from "./diagnostics";
export { prepareLocalExperiment } from "./pipeline";
export { createPreparationRuntime } from "./runtime";
export type { PreparationDependencies, PreparationResult } from "./types";

const JOURNAL_FLAGS: Readonly<Record<string, JournalMode>> = Object.freeze({ "--fresh": "fresh", "--resume": "resume", "--offline": "offline" });
const PROFILE_FLAG = "--profile=";
const JOURNAL_FLAG = "--journal=";
/** A journal file in the journal directory: a plain name, never a path. */
const JOURNAL_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

/**
 * No journal flag starts a fresh journal and refuses to replace one (`JOURNAL_EXISTS`); `--fresh` sets the old one
 * aside first; `--resume` replays the last journal and fetches the rest; `--offline` only replays.
 * `--profile=<version>` runs another profile in `ops/poc/profiles`, and `--journal=<name>` another journal file.
 * Each flag may appear once.
 */
export const parsePreparationArguments = (argv: readonly string[]): Omit<DependencyOptions, "signal"> | undefined => {
  let mode: string | undefined;
  let profile: string | undefined;
  let journalFile: string | undefined;
  for (const argument of argv) {
    if (Object.hasOwn(JOURNAL_FLAGS, argument) && mode === undefined) mode = argument;
    else if (argument.startsWith(PROFILE_FLAG) && profile === undefined) profile = argument.slice(PROFILE_FLAG.length);
    else if (argument.startsWith(JOURNAL_FLAG) && journalFile === undefined) journalFile = argument.slice(JOURNAL_FLAG.length);
    else return undefined;
  }
  const version = PROFILE_VERSIONS.find((known) => known === profile);
  if ((profile !== undefined && version === undefined) || (journalFile !== undefined && !JOURNAL_FILE.test(journalFile))) return undefined;
  return Object.freeze({
    journal: JOURNAL_FLAGS[mode ?? "--fresh"]!, setAside: mode === "--fresh",
    ...(version ? { profile: version } : {}), ...(journalFile ? { journalFile } : {}),
  });
};

/** The accepted forms of the command, printed after the stable code when it gets anything else. */
export const PREPARATION_USAGE = "usage: pnpm prepare:poc [--fresh | --resume | --offline] [--profile=<version>] [--journal=<name>]";

const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;
type SignalSource = Pick<NodeJS.EventEmitter, "on" | "off">;

/**
 * Aborts the run on the first SIGINT or SIGTERM, so it stops at its next request as `RUN_INTERRUPTED` and still
 * journals what it has. The listeners go with the first signal, so a second one ends the process at once.
 * Returns the release.
 */
export const abortOnSignals = (controller: AbortController, source: SignalSource = process): (() => void) => {
  const release = (): void => { for (const signal of STOP_SIGNALS) source.off(signal, abort); };
  const abort = (): void => { release(); controller.abort(); };
  for (const signal of STOP_SIGNALS) source.on(signal, abort);
  return release;
};

/** A rate-limit checkpoint exits 75 (`EX_TEMPFAIL`) for `--resume` after the reset, an interrupted run 130, any other failure 1. */
const STOP_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({ RATE_LIMIT_CHECKPOINT: 75, RUN_INTERRUPTED: 130 });
export const exitCodeOf = (error: unknown): number =>
  error instanceof PreparationError && error.stop !== undefined && Object.hasOwn(STOP_EXIT_CODES, error.stop) ? STOP_EXIT_CODES[error.stop]! : 1;

export const runPreparationCli = async (log: (message: string) => void = console.error): Promise<PreparationResult> => {
  const options = parsePreparationArguments(process.argv.slice(2));
  if (options === undefined) {
    // The arguments themselves are never echoed: a mistyped one could carry a URL or a token.
    log("COMMAND_ARGUMENTS_REJECTED");
    log(PREPARATION_USAGE);
    return Promise.reject(new Error("COMMAND_ARGUMENTS_REJECTED"));
  }
  const interruption = new AbortController();
  const release = abortOnSignals(interruption);
  try {
    return await prepareLocalExperiment(defaultDependencies({ ...options, signal: interruption.signal }));
  } finally {
    release();
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runPreparationCli().catch((error: unknown) => { process.exitCode = exitCodeOf(error); });
}
