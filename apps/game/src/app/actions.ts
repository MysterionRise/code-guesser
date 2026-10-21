"use server";

import { headers } from "next/headers";

import type { GameRefusal, HintRequest, HintResponse, RevealRequest, RevealResponse } from "../components/arcade";
import type { CreateChallengeResponse, DuelRefusal, IssueResultRequest, IssueResultResponse } from "../components/duel/duel-contract";
import { activeLocalRealExperiment } from "../demo/local-real-experiment-loader.server";
import { clientKey } from "../server/client-key.server";
import { limited } from "../server/rate-limit.server";

const SESSION_ENDED: GameRefusal = { ok: false, reason: "SESSION_ENDED" };
const RATE_LIMITED: GameRefusal = { ok: false, reason: "RATE_LIMITED" };
const DUEL_SESSION_ENDED: DuelRefusal = { ok: false, reason: "SESSION_ENDED" };
const DUEL_RATE_LIMITED: DuelRefusal = { ok: false, reason: "RATE_LIMITED" };

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

/** A challenge link for the player's finished game (#173). */
export async function createDuelChallenge(sessionToken: string): Promise<CreateChallengeResponse> {
  if (limited("duel_create", clientKey(await headers()))) return DUEL_RATE_LIMITED;
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.createChallenge(sessionToken) : DUEL_SESSION_ENDED;
}

/** A result link for a friend's finished game of a challenge (#173). */
export async function issueDuelResult(request: IssueResultRequest): Promise<IssueResultResponse> {
  if (limited("duel_create", clientKey(await headers()))) return DUEL_RATE_LIMITED;
  const loaded = activeLocalRealExperiment();
  return loaded.ok ? loaded.experiment.issueResult(request?.sessionToken, request?.challengeToken) : DUEL_SESSION_ENDED;
}
