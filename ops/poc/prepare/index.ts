import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defaultDependencies } from "./dependencies";
import type { JournalMode } from "./journal";
import { prepareLocalExperiment } from "./pipeline";
import type { PreparationResult } from "./types";

export { projectBlobWorkerEnvironment } from "./blob-worker";
export { projectPreparationEnvironment } from "./dependencies";
export { PreparationError } from "./diagnostics";
export { prepareLocalExperiment } from "./pipeline";
export { createPreparationRuntime } from "./runtime";
export type { PreparationDependencies, PreparationResult } from "./types";

const JOURNAL_FLAGS: Readonly<Record<string, JournalMode>> = Object.freeze({ "--resume": "resume", "--offline": "offline" });

/** No argument starts a fresh journal; `--resume` replays the last journal and fetches the rest; `--offline` only replays. */
export const parsePreparationArguments = (argv: readonly string[]): JournalMode | undefined => {
  if (argv.length === 0) return "fresh";
  return argv.length === 1 ? JOURNAL_FLAGS[argv[0]!] : undefined;
};

export const runPreparationCli = async (): Promise<PreparationResult> => {
  const journal = parsePreparationArguments(process.argv.slice(2));
  return journal === undefined ? Promise.reject(new Error("COMMAND_ARGUMENTS_REJECTED"))
    : prepareLocalExperiment(defaultDependencies({ journal }));
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runPreparationCli().catch(() => { process.exitCode = 1; });
}
