"use server";

import type { RevealRequest } from "../components/arcade";
import { activeLocalRealExperiment } from "../demo/local-real-experiment-loader.server";

export async function authorizeLocalExperimentReveal(request: RevealRequest) {
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) throw new Error("local experiment unavailable");
  return loaded.experiment.createReveal(request);
}
