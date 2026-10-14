"use server";

import type { GameRefusal, HintRequest, HintResponse, RevealRequest, RevealResponse } from "../components/arcade";
import { activeLocalRealExperiment } from "../demo/local-real-experiment-loader.server";

const SESSION_ENDED: GameRefusal = { ok: false, reason: "SESSION_ENDED" };

export async function authorizeLocalExperimentReveal(request: RevealRequest): Promise<RevealResponse> {
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.answer(request) : SESSION_ENDED;
}

export async function revealLocalExperimentHint(request: HintRequest): Promise<HintResponse> {
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.revealHint(request) : SESSION_ENDED;
}
