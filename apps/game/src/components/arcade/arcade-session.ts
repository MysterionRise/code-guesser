import { ArcadeShellRuleError, requirePublicText as required, type PublicModeContract } from "./mode-contract";

/**
 * A game's client-side session: the rounds played so far, the hints bought, and the locked answer. The server holds
 * the game itself (#96); this only checks that what it returns fits the round being played.
 */

/** Locks in an answer for the round being played; the server reads progress, hints, and score from its own token. */
export interface RevealRequest {
  sessionToken: string;
  roundId: string;
  candidateId: string;
}

/** Buys the next hint of the round being played. */
export interface HintRequest {
  sessionToken: string;
  roundId: string;
}

/** Why the server would not act: it cannot continue this game, or the request does not fit the game's state. */
export type GameRefusal = Readonly<{ ok: false; reason: "SESSION_ENDED" | "REJECTED" }>;
export type RevealResponse = Readonly<{ ok: true; reveal: AuthorizedReveal; sessionToken: string }> | GameRefusal;
export type HintResponse = Readonly<{ ok: true; hint: string; sessionToken: string }> | GameRefusal;

export interface AuthorizedReveal {
  roundId: string;
  roundVersionId: string;
  correct: boolean;
  /** The right option, shown once the answer is locked. */
  answerCandidateId: string;
  score: number;
  evidence: string;
  explanation: string;
  attribution: string;
  helpfulSignals: readonly string[];
  misleadingSignals: readonly string[];
  versions: { content: string; candidateSet: string; scoring: string; rules: string; evidence: string; reveal: string };
  result: EntertainmentResultProjection;
}

export interface EntertainmentResultProjection {
  score: number;
  attainableMaximum: number;
  completedRounds: number;
  resultVersionId: string;
}

export interface ArcadeSession {
  readonly roundIndex: number;
  readonly visibleHintCount: number;
  /** The current round's bought hints, in order; always `visibleHintCount` long. */
  readonly hints: readonly string[];
  readonly lockedCandidateId: string | null;
  readonly reveal: AuthorizedReveal | null;
  readonly score: number;
  readonly completedRounds: number;
  readonly correctRounds: number;
  /** Whether each answered round was right, in play order. */
  readonly outcomes: readonly boolean[];
  readonly result: EntertainmentResultProjection | null;
  readonly status: "playing" | "complete";
}

export type ArcadeSessionAction =
  | { type: "reveal-hint"; label: string }
  | { type: "lock-answer"; candidateId: string }
  | { type: "accept-reveal"; reveal: AuthorizedReveal }
  | { type: "next-round" };

export function createArcadeSession(_mode: PublicModeContract): ArcadeSession {
  return Object.freeze({ roundIndex: 0, visibleHintCount: 0, hints: Object.freeze([]), lockedCandidateId: null,
    reveal: null, score: 0, completedRounds: 0, correctRounds: 0, outcomes: Object.freeze([]), result: null, status: "playing" });
}

export function projectDisplayReveal(value: unknown): AuthorizedReveal {
  if (typeof value !== "object" || value === null) throw new ArcadeShellRuleError("invalid reveal projection");
  const source = value as Record<string, unknown>;
  const allowed = ["attribution", "correct", "answerCandidateId", "evidence", "explanation", "helpfulSignals", "misleadingSignals", "result", "roundId", "roundVersionId", "score", "versions"];
  if (Object.keys(source).some((key) => !allowed.includes(key))) throw new ArcadeShellRuleError("reveal contains an unexpected field");
  const versions = source.versions as Record<string, unknown> | undefined;
  const result = source.result as Record<string, unknown> | undefined;
  const versionKeys = ["candidateSet", "content", "evidence", "reveal", "rules", "scoring"];
  if (typeof source.roundId !== "string" || typeof source.roundVersionId !== "string"
    || typeof source.correct !== "boolean" || typeof source.answerCandidateId !== "string"
    || typeof source.score !== "number" || !Number.isFinite(source.score)
    || typeof source.evidence !== "string" || typeof source.explanation !== "string"
    || typeof source.attribution !== "string" || !Array.isArray(source.helpfulSignals) || source.helpfulSignals.length === 0
    || source.helpfulSignals.some((signal) => typeof signal !== "string")
    || !Array.isArray(source.misleadingSignals) || source.misleadingSignals.length === 0
    || source.misleadingSignals.some((signal) => typeof signal !== "string") || versions === undefined
    || Object.keys(versions).sort().join("|") !== versionKeys.sort().join("|")
    || versionKeys.some((key) => typeof versions[key] !== "string") || result === undefined
    || Object.keys(result).sort().join("|") !== "attainableMaximum|completedRounds|resultVersionId|score"
    || !Number.isSafeInteger(result.score) || (result.score as number) < 0
    || !Number.isSafeInteger(result.attainableMaximum) || (result.attainableMaximum as number) < 0
    || !Number.isInteger(result.completedRounds) || (result.completedRounds as number) < 0 || (result.completedRounds as number) > 5
    || typeof result.resultVersionId !== "string" || (result.score as number) > (result.attainableMaximum as number)) {
    throw new ArcadeShellRuleError("invalid reveal projection");
  }
  return Object.freeze({
    roundId: required(source.roundId, "reveal round id"), roundVersionId: required(source.roundVersionId, "reveal round version"),
    correct: source.correct,
    answerCandidateId: required(source.answerCandidateId, "answer candidate"),
    score: source.score,
    evidence: required(source.evidence, "display evidence"),
    explanation: required(source.explanation, "display explanation"),
    attribution: required(source.attribution, "display attribution"),
    helpfulSignals: Object.freeze(source.helpfulSignals.map((signal) => required(signal as string, "helpful signal"))),
    misleadingSignals: Object.freeze(source.misleadingSignals.map((signal) => required(signal as string, "misleading signal"))),
    versions: Object.freeze({ content: required(versions.content as string, "content version"),
      candidateSet: required(versions.candidateSet as string, "candidate version"), scoring: required(versions.scoring as string, "scoring version"),
      rules: required(versions.rules as string, "rules version"), evidence: required(versions.evidence as string, "evidence version"), reveal: required(versions.reveal as string, "reveal version") }),
    result: Object.freeze({ score: result.score as number, attainableMaximum: result.attainableMaximum as number,
      completedRounds: result.completedRounds as number, resultVersionId: required(result.resultVersionId as string, "result version") }),
  });
}

export function transitionArcadeSession(
  mode: PublicModeContract,
  session: ArcadeSession,
  action: ArcadeSessionAction,
): ArcadeSession {
  if (session.status === "complete") throw new ArcadeShellRuleError("the run is already complete");
  const round = mode.rounds[session.roundIndex]!;
  if (action.type === "reveal-hint") {
    if (session.lockedCandidateId !== null || session.reveal !== null) throw new ArcadeShellRuleError("clues are unavailable after answer lock");
    if (session.visibleHintCount >= round.mode.clues.length) return session;
    const hints = Object.freeze([...session.hints, required(action.label, "hint")]);
    return Object.freeze({ ...session, visibleHintCount: hints.length, hints });
  }
  if (action.type === "lock-answer") {
    if (session.lockedCandidateId !== null) throw new ArcadeShellRuleError("an answer is already locked for this round");
    if (!round.mode.candidates.some((candidate) => candidate.candidateId === action.candidateId)) {
      throw new ArcadeShellRuleError("the candidate is not available for this round");
    }
    return Object.freeze({ ...session, lockedCandidateId: action.candidateId });
  }
  if (action.type === "accept-reveal") {
    if (session.lockedCandidateId === null) throw new ArcadeShellRuleError("reveal requires a locked answer");
    if (session.reveal !== null) throw new ArcadeShellRuleError("reveal is already accepted for this round");
    const reveal = projectDisplayReveal(action.reveal);
    if (reveal.roundId !== round.roundId || reveal.roundVersionId !== round.roundVersionId || reveal.versions.content !== round.content.versionId
      || reveal.versions.candidateSet !== round.versions.candidateSet || reveal.versions.scoring !== round.versions.scoring || reveal.versions.rules !== round.versions.rules) {
      throw new ArcadeShellRuleError("reveal does not match the active round lineage");
    }
    if (!round.mode.candidates.some(({ candidateId }) => candidateId === reveal.answerCandidateId)
      || reveal.correct !== (session.lockedCandidateId === reveal.answerCandidateId)) {
      throw new ArcadeShellRuleError("reveal does not match the locked answer");
    }
    const completedRounds = session.completedRounds + 1;
    if (reveal.result.completedRounds !== completedRounds) throw new ArcadeShellRuleError("result does not match session progress");
    const expectedRoundScore = reveal.correct ? round.points[session.visibleHintCount]! : 0;
    if (reveal.score !== expectedRoundScore || reveal.result.score !== session.score + expectedRoundScore) {
      throw new ArcadeShellRuleError("reveal score does not match accepted clue and session state");
    }
    return Object.freeze({ ...session, reveal, result: reveal.result,
      score: reveal.result.score, completedRounds, correctRounds: session.correctRounds + (reveal.correct ? 1 : 0),
      outcomes: Object.freeze([...session.outcomes, reveal.correct]),
      status: completedRounds === mode.rounds.length ? "complete" : "playing" });
  }
  // A finished run is never replayed: a new game is a fresh deal from the server, so revealed rounds stay spent.
  if (action.type !== "next-round") throw new ArcadeShellRuleError("unsupported session action");
  if (session.reveal === null) throw new ArcadeShellRuleError("the current round must reveal before navigation");
  if (session.roundIndex >= mode.rounds.length - 1) throw new ArcadeShellRuleError("there is no next round");
  return Object.freeze({ ...session, roundIndex: session.roundIndex + 1, visibleHintCount: 0, hints: Object.freeze([]),
    lockedCandidateId: null, reveal: null });
}
