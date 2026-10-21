"use server";

import type { GameRefusal, HintRequest, HintResponse, RevealRequest, RevealResponse } from "../components/arcade";
import type { CreateChallengeResponse, DuelRefusal, IssueResultRequest, IssueResultResponse } from "../components/duel/duel-contract";
import { activeLocalRealExperiment } from "../demo/local-real-experiment-loader.server";

const SESSION_ENDED: GameRefusal = { ok: false, reason: "SESSION_ENDED" };
const DUEL_SESSION_ENDED: DuelRefusal = { ok: false, reason: "SESSION_ENDED" };

export async function authorizeLocalExperimentReveal(request: RevealRequest): Promise<RevealResponse> {
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.answer(request) : SESSION_ENDED;
}

export async function revealLocalExperimentHint(request: HintRequest): Promise<HintResponse> {
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.revealHint(request) : SESSION_ENDED;
}

/** A challenge link for the player's finished game (#173). */
export async function createDuelChallenge(sessionToken: string): Promise<CreateChallengeResponse> {
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.createChallenge(sessionToken) : DUEL_SESSION_ENDED;
}

/** A result link for a friend's finished game of a challenge (#173). */
export async function issueDuelResult(request: IssueResultRequest): Promise<IssueResultResponse> {
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.issueResult(request?.sessionToken, request?.challengeToken) : DUEL_SESSION_ENDED;
}
