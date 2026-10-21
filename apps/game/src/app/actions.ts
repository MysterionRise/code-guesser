"use server";

import { headers } from "next/headers";

import type { GameRefusal, HintRequest, HintResponse, RevealRequest, RevealResponse } from "../components/arcade";
import { activeLocalRealExperiment } from "../demo/local-real-experiment-loader.server";
import { clientKey } from "../server/client-key.server";
import { limited } from "../server/rate-limit.server";

const SESSION_ENDED: GameRefusal = { ok: false, reason: "SESSION_ENDED" };
const RATE_LIMITED: GameRefusal = { ok: false, reason: "RATE_LIMITED" };

export async function authorizeLocalExperimentReveal(request: RevealRequest): Promise<RevealResponse> {
  if (limited("reveal", clientKey(await headers()))) return RATE_LIMITED;
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.answer(request) : SESSION_ENDED;
}

export async function revealLocalExperimentHint(request: HintRequest): Promise<HintResponse> {
  if (limited("hint", clientKey(await headers()))) return RATE_LIMITED;
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.revealHint(request) : SESSION_ENDED;
}
