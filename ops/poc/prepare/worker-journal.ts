import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalBytes } from "./canonical";
import type { RunJournal } from "./journal";
import { runLockedWorker, type WorkerRequest, type WorkerResult } from "./stack-metadata";

const RUNTIME_DIRECTORY = fileURLToPath(new URL("../stack/", import.meta.url));
/** Request fields that only carry the run's remaining budget; the same rows are read whatever they are. */
const BUDGET_FIELDS = new Set(["requestLimit", "networkByteLimit", "temporaryDiskBytes", "limits"]);

let workerCodeHash: string | undefined;
/** Worker source and lock file: a worker change invalidates its recorded outputs. */
const currentWorkerCode = (): string => {
  if (workerCodeHash === undefined) {
    const hash = createHash("sha256");
    const files = readdirSync(RUNTIME_DIRECTORY).filter((name) => (name.endsWith(".py") && !name.startsWith("test_")) || name === "uv.lock").sort();
    for (const name of files) hash.update(name).update("\0").update(readFileSync(join(RUNTIME_DIRECTORY, name))).update("\0");
    workerCodeHash = hash.digest("hex");
  }
  return workerCodeHash;
};

/** The worker, its code, and what it was asked to read, without the budget fields. */
export const workerJournalKey = (request: WorkerRequest, codeHash: string = currentWorkerCode()): string => {
  const script = basename(request.args.at(-1) ?? "");
  const input = JSON.parse(request.stdin) as Record<string, unknown>;
  const asked = Object.fromEntries(Object.entries(input).filter(([key]) => !BUDGET_FIELDS.has(key)));
  return `worker\0${script}\0${codeHash}\0${new TextDecoder().decode(canonicalBytes(asked))}`;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Replays a recorded successful worker output, or runs the worker and records a successful one.
 * Node still validates and meters the replayed output exactly as a live one.
 */
export const journaledWorker = (
  journal: RunJournal,
  run: (request: WorkerRequest) => Promise<WorkerResult> = runLockedWorker,
  codeHash?: string,
) => async (request: WorkerRequest): Promise<WorkerResult> => {
  const key = workerJournalKey(request, codeHash);
  const recorded = journal.take(key, "fixed");
  if (recorded) return { exitCode: 0, stdout: new TextEncoder().encode(String(recorded.body)), stderr: new Uint8Array() };
  const result = await run(request);
  if (result.exitCode === 0 && result.stderr.byteLength === 0 && result.stdout.byteLength <= request.stdoutByteLimit) {
    let text: string | undefined;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout); } catch { text = undefined; }
    if (text !== undefined) {
      journal.record({ key, policy: "fixed", sha256: sha256(result.stdout), byteLength: result.stdout.byteLength, encoding: "text", body: text });
    }
  }
  return result;
};
