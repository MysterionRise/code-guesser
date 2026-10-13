"use client";

import * as React from "react";
import { ArcadeShellRuleError, optionLine, requirePublicText as required, type PublicModeContract, type RoundModeKind } from "./mode-contract";

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
  readonly lockedCandidateId: string | null;
  readonly reveal: AuthorizedReveal | null;
  readonly score: number;
  readonly completedRounds: number;
  readonly correctRounds: number;
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
    reveal: null, score: 0, completedRounds: 0, correctRounds: 0, result: null, status: "playing" });
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
      status: completedRounds === mode.rounds.length ? "complete" : "playing" });
  }
  if (session.reveal === null) throw new ArcadeShellRuleError("the current round must reveal before navigation");
  if (session.roundIndex >= mode.rounds.length - 1) throw new ArcadeShellRuleError("there is no next round");
  return Object.freeze({ ...session, roundIndex: session.roundIndex + 1, visibleHintCount: 0,
    lockedCandidateId: null, reveal: null });
}

const points = (value: number): string => value.toLocaleString("en-US");

/** The share line names the deck and the tally, never a round's content or answer. */
export function projectSpoilerFreeShare(result: EntertainmentResultProjection, correctRounds: number, deckTitle?: string) {
  if (result.completedRounds !== 5) throw new ArcadeShellRuleError("sharing requires a complete run");
  if (!Number.isInteger(correctRounds) || correctRounds < 0 || correctRounds > result.completedRounds) {
    throw new ArcadeShellRuleError("correct rounds must be within the completed rounds");
  }
  const parts = ["CodeGuessr", ...(deckTitle ? [deckTitle] : []),
    `${correctRounds}/${result.completedRounds} correct`, `${points(result.score)}/${points(result.attainableMaximum)}`];
  return Object.freeze({
    text: parts.join(" · "),
    score: result.score,
    rounds: result.completedRounds,
    correct: correctRounds,
  });
}

export function formatCompletionResult(result: EntertainmentResultProjection, correctRounds: number, deckTitle?: string): string {
  const share = projectSpoilerFreeShare(result, correctRounds, deckTitle);
  return `Run complete — ${points(result.score)} points, ${correctRounds} of ${result.completedRounds} correct. Share: ${share.text}.`;
}

/** The round's own points after zero, one, and two hints. */
export const hintCostNote = (values: readonly number[]): string =>
  `Each hint lowers this round’s points: ${values.map(points).join(" → ")}.`;
const SOURCE_LINK = /(https:\/\/\S+)/u;

/** What a single pane shows, where a deck's code needs a word of explanation; comparison panes name their version. */
export const PANE_CAPTIONS: Readonly<Partial<Record<RoundModeKind, string>>> = Object.freeze({
  algorithm: "Its own names, and any option's name, are hidden as mystery.",
  output: "The last line is a call typed into a Python shell.",
  fix: "Lines are numbered; each option names one.",
});

/** Renders the public attribution with its source address as a link; the text itself is unchanged. */
const linkedAttribution = (attribution: string): React.ReactNode[] => attribution.split(SOURCE_LINK)
  .map((part, index) => index % 2 === 1
    ? <a key={index} href={part} rel="noreferrer noopener" target="_blank">{part}</a>
    : part);

interface ArcadeShellProps {
  mode: PublicModeContract;
  authorizeRevealAction: (request: RevealRequest) => Promise<AuthorizedReveal>;
  /** When set, completion also links back to the deck chooser. */
  chooseAnotherDeckHref?: string;
  /** When set, completion links to a freshly dealt game from the same deck. */
  newGameHref?: string;
  /** When set, the share line names the deck. */
  deckTitle?: string;
}

export function ArcadeShell({ mode, authorizeRevealAction, chooseAnotherDeckHref, newGameHref, deckTitle }: ArcadeShellProps) {
  const [session, setSession] = React.useState(() => createArcadeSession(mode));
  const [selection, setSelection] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [focusedCandidate, setFocusedCandidate] = React.useState<string | null>(null);
  const round = mode.rounds[session.roundIndex]!;
  // A fix round's options point at pane lines: the pane numbers its lines, each option shows its line's code, and
  // the line under the focused or chosen option (or, once revealed, the answer) is highlighted.
  const numbered = round.mode.kind === "fix" && round.content.panes.length === 1;
  const paneLines = numbered ? round.content.panes[0]!.text.split("\n") : [];
  const labelOf = (candidateId: string | null) => round.mode.candidates.find((candidate) => candidate.candidateId === candidateId)?.label ?? "";
  const highlighted = numbered
    ? optionLine(labelOf(session.reveal?.answerCandidateId ?? focusedCandidate ?? (selection === "" ? null : selection)))
    : undefined;
  const roundTitle = React.useRef<HTMLHeadingElement>(null);
  const revealHeading = React.useRef<HTMLHeadingElement>(null);
  const settled = React.useRef(false);

  // Keyboard and screen-reader users land on the verdict after answering and on the next prompt after
  // moving on; the first render leaves focus alone.
  React.useEffect(() => {
    if (!settled.current) { settled.current = true; return; }
    (session.reveal ? revealHeading : roundTitle).current?.focus();
  }, [session.reveal, session.roundIndex]);

  const copyResult = async () => {
    if (!session.result) return;
    try {
      await navigator.clipboard.writeText(projectSpoilerFreeShare(session.result, session.correctRounds, deckTitle).text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

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
    setFocusedCandidate(null);
    setError(null);
  };

  const restart = () => {
    setSession((current) => transitionArcadeSession(mode, current, { type: "restart" }));
    setSelection("");
    setError(null);
    setCopied(false);
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

      <section className="game-card" aria-labelledby="round-title" data-round-id={round.roundId}>
        <p className="eyebrow">Round {session.roundIndex + 1} of {mode.rounds.length}</p>
        <h1 id="round-title" ref={roundTitle} tabIndex={-1}>{round.mode.prompt}</h1>
        <div className={round.content.panes.length > 1 ? "code-panes compare" : "code-panes"}>
          {round.content.panes.map((pane, index) => (
            <figure className="code-pane" key={pane.label ?? index}>
              {pane.label ? <figcaption>Version {pane.label}</figcaption>
                : PANE_CAPTIONS[round.mode.kind] && <figcaption className="pane-note">{PANE_CAPTIONS[round.mode.kind]}</figcaption>}
              {numbered
                ? <pre className="code-window numbered" tabIndex={0} aria-label="Code excerpt with numbered lines"><code>
                    {paneLines.map((line, lineIndex) => (
                      <span className={lineIndex + 1 === highlighted ? "code-line highlighted" : "code-line"} data-line={lineIndex + 1} key={lineIndex}>
                        <span className="line-number" aria-hidden="true">{lineIndex + 1}</span>{line}
                      </span>
                    ))}
                  </code></pre>
                : <pre className="code-window" tabIndex={0} aria-label={pane.label ? `Code, version ${pane.label}` : "Code excerpt"}><code>{pane.text}</code></pre>}
            </figure>
          ))}
        </div>

        <p className="hint-cost" id={`hint-cost-${round.roundId}`}>{hintCostNote(round.points)}</p>
        <div className="hints" aria-label="Hints">
          {round.mode.clues.map((clue, index) => index < session.visibleHintCount
            ? <p className="hint" key={clue.order}>{clue.label}</p>
            : index === session.visibleHintCount
              ? <button className="hint-button" type="button" key={clue.order} aria-describedby={`hint-cost-${round.roundId}`} disabled={busy || session.lockedCandidateId !== null} onClick={() => setSession((current) => transitionArcadeSession(mode, current, { type: "reveal-hint" }))}>
                  Reveal hint {clue.order}
                </button>
              : null)}
        </div>

        <fieldset disabled={session.reveal !== null || busy}>
          <legend>Choose one answer</legend>
          <div className="candidate-grid">
            {round.mode.candidates.map((candidate) => {
              const verdict = session.reveal === null ? ""
                : candidate.candidateId === session.reveal.answerCandidateId ? " correct"
                  : candidate.candidateId === session.lockedCandidateId ? " missed" : "";
              const detailId = `detail-${round.roundId}-${candidate.candidateId}`;
              const line = numbered ? optionLine(candidate.label) : undefined;
              const lineText = line === undefined ? undefined : paneLines[line - 1]?.trim();
              const detail = candidate.detail ?? lineText ?? null;
              return (
                <label className={`${selection === candidate.candidateId ? "candidate selected" : "candidate"}${verdict}`} key={candidate.candidateId}>
                  <input
                    type="radio"
                    name={`candidate-${round.roundId}`}
                    value={candidate.candidateId}
                    aria-label={candidate.label}
                    aria-describedby={detail ? detailId : undefined}
                    checked={selection === candidate.candidateId}
                    onChange={() => setSelection(candidate.candidateId)}
                    onFocus={numbered ? () => setFocusedCandidate(candidate.candidateId) : undefined}
                    onBlur={numbered ? () => setFocusedCandidate(null) : undefined}
                  />
                  <span className="candidate-text">
                    <span className="candidate-label">{candidate.label}</span>
                    {detail && <span className={lineText ? "candidate-detail code-detail" : "candidate-detail"} id={detailId}>{detail}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <button className="answer-button" type="button" disabled={selection === "" || session.reveal !== null || busy} onClick={submit}>
          {busy ? "Checking…" : "Lock in answer"}
        </button>
        {error && <p className="demo-error" role="alert">{error}</p>}

        <div className="reveal" aria-live="polite" aria-atomic="true">
          {session.reveal && (
            <>
              <h2 ref={revealHeading} tabIndex={-1}>{session.reveal.correct ? "Nice read." : "Not this time."}</h2>
              <p className="answer-line">The answer: <strong>{round.mode.candidates.find(({ candidateId }) => candidateId === session.reveal!.answerCandidateId)?.label}</strong></p>
              <p>{session.reveal.evidence}</p>
              <p>{session.reveal.explanation}</p>
              <p>Helpful signals: {session.reveal.helpfulSignals.join(" · ")}</p>
              <p>Misleading signals: {session.reveal.misleadingSignals.join(" · ")}</p>
              <small>{linkedAttribution(session.reveal.attribution)}</small>
              {session.status !== "complete"
                ? <button type="button" onClick={next}>Next round</button>
                : <>
                    <p>{formatCompletionResult(session.result!, session.correctRounds, deckTitle)}</p>
                    <button type="button" onClick={copyResult}>{copied ? "Copied" : "Copy result"}</button>
                    <button type="button" onClick={restart}>Play again</button>
                    {newGameHref && <a className="deck-link" href={newGameHref}>Deal new rounds</a>}
                    {chooseAnotherDeckHref && <a className="deck-link" href={chooseAnotherDeckHref}>Choose another deck</a>}
                  </>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
