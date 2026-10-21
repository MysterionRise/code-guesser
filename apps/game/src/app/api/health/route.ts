import { accessSync, constants, mkdirSync } from "node:fs";

import { activeLocalRealExperiment } from "../../../demo/local-real-experiment-loader.server";
import { stateStore } from "../../../server/state-store.server";

/**
 * The host's health check (#164): 200 `ok`, or 503 with one bare code. It checks that the artifact loaded and that
 * the state and event directories, when configured, can be written. It reads nothing from the request and records
 * nothing, so it needs no rate limit.
 */
export const dynamic = "force-dynamic";

/** A directory the server writes to, created as the game would create it. */
const writable = (directory: string): boolean => {
  try {
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const failure = (): string | null => {
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return `ARTIFACT_${loaded.reason}`;
  const stateDirectory = process.env.CODEGUESSR_STATE_DIR;
  if (stateDirectory) {
    if (!writable(stateDirectory)) return "STATE_DIR_UNWRITABLE";
    try {
      stateStore();
    } catch {
      return "STATE_STORE_UNAVAILABLE";
    }
  }
  const eventsDirectory = process.env.EXPERIMENT_EVENTS_DIR;
  if (eventsDirectory && !writable(eventsDirectory)) return "EVENTS_DIR_UNWRITABLE";
  return null;
};

export function GET(): Response {
  const code = failure();
  return new Response(code ?? "ok", {
    status: code === null ? 200 : 503,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}
