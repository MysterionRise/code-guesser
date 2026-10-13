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

const WORKER_REASON = /^[A-Z][A-Z0-9_]{0,63}$/u;
/** The one stable reason code a failed worker wrote to stderr, if that is all it wrote. */
const workerReason = (stderr: Uint8Array): string | undefined => {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(stderr); } catch { return undefined; }
  const reason = text.endsWith("\n") ? text.slice(0, -1) : text;
  return WORKER_REASON.test(reason) ? reason : undefined;
};

/**
 * Replays a recorded worker output, or runs the worker and records it. A successful output replays on resume
 * and offline; a failure with a reason code replays only offline, so a resumed run tries the worker again.
 * Node still validates and meters the replayed output exactly as a live one.
 */
export const journaledWorker = (
  journal: RunJournal,
  run: (request: WorkerRequest) => Promise<WorkerResult> = runLockedWorker,
  codeHash?: string,
) => async (request: WorkerRequest): Promise<WorkerResult> => {
  const key = workerJournalKey(request, codeHash);
  const recorded = journal.take(key, "fixed");
  if (recorded?.encoding === "failure") {
    const { exitCode, reason } = recorded.body as { exitCode: number; reason: string };
    return { exitCode, stdout: new Uint8Array(), stderr: new TextEncoder().encode(`${reason}\n`) };
  }
  if (recorded) return { exitCode: 0, stdout: new TextEncoder().encode(String(recorded.body)), stderr: new Uint8Array() };
  const result = await run(request);
  const reason = result.exitCode !== 0 ? workerReason(result.stderr) : undefined;
  if (reason !== undefined) {
    const body = { exitCode: result.exitCode, reason };
    journal.record({ key, policy: "offline", sha256: sha256(canonicalBytes(body)), byteLength: 0, encoding: "failure", body });
  }
  if (result.exitCode === 0 && result.stderr.byteLength === 0 && result.stdout.byteLength <= request.stdoutByteLimit) {
    let text: string | undefined;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout); } catch { text = undefined; }
    if (text !== undefined) {
      journal.record({ key, policy: "fixed", sha256: sha256(result.stdout), byteLength: result.stdout.byteLength, encoding: "text", body: text });
    }
  }
  return result;
};
