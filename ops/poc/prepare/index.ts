import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { prepareLocalExperiment } from "./pipeline";
import type { PreparationResult } from "./types";

export { projectBlobWorkerEnvironment } from "./blob-worker";
export { projectPreparationEnvironment } from "./dependencies";
export { PreparationError } from "./diagnostics";
export { prepareLocalExperiment } from "./pipeline";
export { createPreparationRuntime } from "./runtime";
export type { PreparationDependencies, PreparationResult } from "./types";

export const runPreparationCli = async (): Promise<PreparationResult> =>
  process.argv.slice(2).length === 0 ? prepareLocalExperiment() : Promise.reject(new Error("COMMAND_ARGUMENTS_REJECTED"));

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runPreparationCli().catch(() => { process.exitCode = 1; });
}
