"use client";

import * as React from "react";
import { ArcadeShellRuleError, requirePublicText as required, type PublicModeContract } from "./mode-contract";

export interface RevealRequest {
  roundId: string;
  candidateId: string;
  roundVersionId: string;
  completedRounds: number;
  currentScore: number;
  cluesUsed: number;
}

export interface AuthorizedReveal {
  roundId: string;
  roundVersionId: string;
  correct: boolean;
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
  readonly lockedCandidateId: string | null;
  readonly reveal: AuthorizedReveal | null;
  readonly score: number;
  readonly completedRounds: number;
  readonly result: EntertainmentResultProjection | null;
  readonly status: "playing" | "complete";
}

export type ArcadeSessionAction =
  | { type: "reveal-hint" }
  | { type: "lock-answer"; candidateId: string }
  | { type: "accept-reveal"; reveal: AuthorizedReveal }
  | { type: "next-round" }
  | { type: "restart" };


export function createArcadeSession(_mode: PublicModeContract): ArcadeSession {
  return Object.freeze({ roundIndex: 0, visibleHintCount: 0, lockedCandidateId: null,
    reveal: null, score: 0, completedRounds: 0, result: null, status: "playing" });
}

export function projectDisplayReveal(value: unknown): AuthorizedReveal {
  if (typeof value !== "object" || value === null) throw new ArcadeShellRuleError("invalid reveal projection");
  const source = value as Record<string, unknown>;
  const allowed = ["attribution", "correct", "evidence", "explanation", "helpfulSignals", "misleadingSignals", "result", "roundId", "roundVersionId", "score", "versions"];
  if (Object.keys(source).some((key) => !allowed.includes(key))) throw new ArcadeShellRuleError("reveal contains an unexpected field");
  const versions = source.versions as Record<string, unknown> | undefined;
  const result = source.result as Record<string, unknown> | undefined;
  const versionKeys = ["candidateSet", "content", "evidence", "reveal", "rules", "scoring"];
  if (typeof source.roundId !== "string" || typeof source.roundVersionId !== "string"
    || typeof source.correct !== "boolean" || typeof source.score !== "number" || !Number.isFinite(source.score)
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
  if (action.type === "restart") return createArcadeSession(mode);
  if (session.status === "complete") throw new ArcadeShellRuleError("the run is already complete");
  const round = mode.rounds[session.roundIndex]!;
  if (action.type === "reveal-hint") {
    if (session.lockedCandidateId !== null || session.reveal !== null) throw new ArcadeShellRuleError("clues are unavailable after answer lock");
    return Object.freeze({ ...session, visibleHintCount: Math.min(session.visibleHintCount + 1, round.mode.clues.length) });
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
    if (reveal.roundId !== round.roundId || reveal.roundVersionId !== round.roundVersionId || reveal.versions.content !== round.excerpt.versionId
      || reveal.versions.candidateSet !== round.versions.candidateSet || reveal.versions.scoring !== round.versions.scoring || reveal.versions.rules !== round.versions.rules) {
      throw new ArcadeShellRuleError("reveal does not match the active round lineage");
    }
    const completedRounds = session.completedRounds + 1;
    if (reveal.result.completedRounds !== completedRounds) throw new ArcadeShellRuleError("result does not match session progress");
    const expectedRoundScore = reveal.correct ? [1000, 800, 500][session.visibleHintCount]! : 0;
    if (reveal.score !== expectedRoundScore || reveal.result.score !== session.score + expectedRoundScore) {
      throw new ArcadeShellRuleError("reveal score does not match accepted clue and session state");
    }
    return Object.freeze({ ...session, reveal, result: reveal.result,
      score: reveal.result.score, completedRounds,
      status: completedRounds === mode.rounds.length ? "complete" : "playing" });
  }
  if (session.reveal === null) throw new ArcadeShellRuleError("the current round must reveal before navigation");
  if (session.roundIndex >= mode.rounds.length - 1) throw new ArcadeShellRuleError("there is no next round");
  return Object.freeze({ ...session, roundIndex: session.roundIndex + 1, visibleHintCount: 0,
    lockedCandidateId: null, reveal: null });
}

export function projectSpoilerFreeShare(result: EntertainmentResultProjection) {
  if (result.completedRounds !== 5) throw new ArcadeShellRuleError("sharing requires a complete run");
  return Object.freeze({
    text: `CodeGuessr ${result.score}/${result.attainableMaximum} · ${result.completedRounds}/5`,
    score: result.score,
    rounds: result.completedRounds,
  });
}

export function formatCompletionResult(result: EntertainmentResultProjection): string {
  const share = projectSpoilerFreeShare(result);
  return `Run complete — ${result.score.toLocaleString()} points. Share: ${share.text}.`;
}

interface ArcadeShellProps {
  mode: PublicModeContract;
  authorizeRevealAction: (request: RevealRequest) => Promise<AuthorizedReveal>;
  /** When set, completion also links back to the deck chooser. */
  chooseAnotherDeckHref?: string;
}

export function ArcadeShell({ mode, authorizeRevealAction, chooseAnotherDeckHref }: ArcadeShellProps) {
  const [session, setSession] = React.useState(() => createArcadeSession(mode));
  const [selection, setSelection] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const round = mode.rounds[session.roundIndex]!;

  const submit = async () => {
    if (selection === "" || session.reveal !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = projectDisplayReveal(await authorizeRevealAction({
        roundId: round.roundId,
        candidateId: selection,
        roundVersionId: round.roundVersionId,
        completedRounds: session.completedRounds,
        currentScore: session.score,
        cluesUsed: session.visibleHintCount,
      }));
      const locked = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: selection });
      setSession(transitionArcadeSession(mode, locked, { type: "accept-reveal", reveal: result }));
    } catch {
      setError("Couldn’t check that answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setSession((current) => transitionArcadeSession(mode, current, { type: "next-round" }));
    setSelection("");
    setError(null);
  };

  const restart = () => {
    setSession((current) => transitionArcadeSession(mode, current, { type: "restart" }));
    setSelection("");
    setError(null);
  };

  return (
    <main className="arcade-shell" data-round-count={mode.rounds.length}>
      <noscript>This game needs JavaScript for answers and progressive evidence.</noscript>
      <header className="arcade-header">
        <a className="brand" href="/">CODEGUESSR</a>
        <span className="score" aria-label={`Score ${session.score}`}>{session.score.toLocaleString()} pts</span>
      </header>

      <nav className="round-track" aria-label="Round progress">
        {mode.rounds.map((item, index) => (
          <span
            className={index === session.roundIndex ? "round-dot current" : index < session.roundIndex ? "round-dot done" : "round-dot"}
            data-round-nav={index + 1}
            key={item.roundId}
            aria-label={`Round ${index + 1}${index === session.roundIndex ? ", current" : ""}`}
          >{index + 1}</span>
        ))}
      </nav>

      <section className="game-card" aria-labelledby="round-title">
        <p className="eyebrow">Round {session.roundIndex + 1} of {mode.rounds.length}</p>
        <h1 id="round-title">{round.mode.prompt}</h1>
        <pre className="code-window"><code>{round.excerpt.text}</code></pre>

        <div className="hints" aria-label="Hints">
          {round.mode.clues.map((clue, index) => index < session.visibleHintCount
            ? <p className="hint" key={clue.order}>{clue.label}</p>
            : index === session.visibleHintCount
              ? <button className="hint-button" type="button" key={clue.order} disabled={busy || session.lockedCandidateId !== null} onClick={() => setSession((current) => transitionArcadeSession(mode, current, { type: "reveal-hint" }))}>
                  Reveal hint {clue.order}
                </button>
              : null)}
        </div>

        <fieldset disabled={session.reveal !== null || busy}>
          <legend>Choose one answer</legend>
          <div className="candidate-grid">
            {round.mode.candidates.map((candidate) => (
              <label className={selection === candidate.candidateId ? "candidate selected" : "candidate"} key={candidate.candidateId}>
                <input
                  type="radio"
                  name={`candidate-${round.roundId}`}
                  value={candidate.candidateId}
                  checked={selection === candidate.candidateId}
                  onChange={() => setSelection(candidate.candidateId)}
                />
                {candidate.label}
              </label>
            ))}
          </div>
        </fieldset>

        <button className="answer-button" type="button" disabled={selection === "" || session.reveal !== null || busy} onClick={submit}>
          {busy ? "Checking…" : "Lock in answer"}
        </button>
        {error && <p className="demo-error" role="alert">{error}</p>}

        <div className="reveal" aria-live="polite" aria-atomic="true">
          {session.reveal && (
            <>
              <h2>{session.reveal.correct ? "Nice read." : "Not this time."}</h2>
              <p>{session.reveal.evidence}</p>
              <p>{session.reveal.explanation}</p>
              <p>Helpful signals: {session.reveal.helpfulSignals.join(" · ")}</p>
              <p>Misleading signals: {session.reveal.misleadingSignals.join(" · ")}</p>
              <small>{session.reveal.attribution}</small>
              {session.status !== "complete"
                ? <button type="button" onClick={next}>Next round</button>
                : <>
                    <p>{formatCompletionResult(session.result!)}</p>
                    <button type="button" onClick={restart}>Play again</button>
                    {chooseAnotherDeckHref && <a className="deck-link" href={chooseAnotherDeckHref}>Choose another deck</a>}
                  </>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
