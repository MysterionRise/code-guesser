"use client";

import * as React from "react";
import { sendEvent } from "../../experiment/beacon";
import { viewportBucket, type ClientEvent, type GenuiEvent } from "../../experiment/events";
import type { Design } from "../../genui/designs";
import type { HostChatProps } from "../../genui/host-chat";
import { AnswerOptions } from "./answer-options";
import {
  createArcadeSession,
  projectDisplayReveal,
  transitionArcadeSession,
  type HintRequest,
  type HintResponse,
  type RevealRequest,
  type RevealResponse,
} from "./arcade-session";
import { SESSION_ENDED_MESSAGE, points } from "./arcade-text";
import { CodePanes } from "./code-panes";
import { HintBar } from "./hint-bar";
import { optionLine, type PublicModeContract } from "./mode-contract";
import { ArcadeHeader, RoundTrack } from "./round-header";
import { QuestionScaffold, markedLines } from "./question-layer";
import { RoundReveal } from "./round-reveal";

/** The host design's chat, fetched only when the server turns it on, so the static game never loads it. */
const HostChat = React.lazy(() => import("../../genui/host-chat")) as React.ComponentType<HostChatProps>;

interface ArcadeShellProps {
  mode: PublicModeContract;
  /** The server's signed hold on this game's progress; every hint and answer returns the next one. */
  sessionToken: string;
  authorizeRevealAction: (request: RevealRequest) => Promise<RevealResponse>;
  revealHintAction: (request: HintRequest) => Promise<HintResponse>;
  /** When set, completion also links back to the deck chooser. */
  chooseAnotherDeckHref?: string;
  /** When set, completion links to a freshly dealt game from the same deck. */
  newGameHref?: string;
  /** When set, the share line names the deck. */
  deckTitle?: string;
  /** When set, a revealed round offers this generative design (#101, #114); the server decides with `GENUI_ENABLED`. */
  genuiDesign?: Design;
}

export function ArcadeShell({ mode, sessionToken, authorizeRevealAction, revealHintAction, chooseAnotherDeckHref, newGameHref, deckTitle, genuiDesign }: ArcadeShellProps) {
  const [session, setSession] = React.useState(() => createArcadeSession(mode));
  const token = React.useRef(sessionToken);
  const currentToken = React.useCallback(() => token.current, []);
  const hintPending = React.useRef(false);
  // Shown as state too, so "Lock in answer" waits visibly while a hint loads instead of ignoring the press.
  const [hintLoading, setHintLoading] = React.useState(false);
  const [hintError, setHintError] = React.useState<string | null>(null);
  const [ended, setEnded] = React.useState(false);
  const [selection, setSelection] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [focusedCandidate, setFocusedCandidate] = React.useState<string | null>(null);
  const round = mode.rounds[session.roundIndex]!;
  // A fix round's options point at pane lines: the pane numbers its lines, each option shows its line's code, and
  // the line under the focused or chosen option (or, once revealed, the answer) is highlighted.
  // A Marker hunt layer's hint points at lines, so its round numbers them too (#128).
  const numbered = (round.mode.kind === "fix" || round.scaffold?.design === "marker-hunt") && round.content.panes.length === 1;
  const paneLines = numbered ? round.content.panes[0]!.text.split("\n") : [];
  const labelOf = (candidateId: string | null) => round.mode.candidates.find((candidate) => candidate.candidateId === candidateId)?.label ?? "";
  const highlighted = numbered && round.mode.kind === "fix"
    ? optionLine(labelOf(session.reveal?.answerCandidateId ?? focusedCandidate ?? (selection === "" ? null : selection)))
    : undefined;
  const roundTitle = React.useRef<HTMLHeadingElement>(null);
  const revealHeading = React.useRef<HTMLHeadingElement>(null);
  const hintButton = React.useRef<HTMLButtonElement>(null);
  const latestHint = React.useRef<HTMLParagraphElement>(null);
  const answerButton = React.useRef<HTMLButtonElement>(null);
  const settled = React.useRef(false);

  // The event log (#107) hears from the browser only what the server can't see: the viewport, the way on from a
  // finished game, a copied result, and what the player does with a generative panel.
  const track = React.useCallback((event: ClientEvent) => sendEvent(token.current, event), []);
  // Once per game, though React's strict mode runs effects twice in development.
  const viewed = React.useRef(false);
  React.useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track({ type: "game_viewed", viewport: viewportBucket(window.innerWidth) });
  }, [track]);
  const roundNumber = session.roundIndex + 1;
  const trackGenui = React.useCallback((event: GenuiEvent) => track({ ...event, round: roundNumber }), [track, roundNumber]);

  // Keyboard and screen-reader users land on the verdict after answering and on the next prompt after
  // moving on; the first render leaves focus alone.
  React.useEffect(() => {
    if (!settled.current) { settled.current = true; return; }
    (session.reveal ? revealHeading : roundTitle).current?.focus();
  }, [session.reveal, session.roundIndex]);

  // A revealed hint replaces the button that asked for it, so focus moves on to the next hint button, or to the
  // hint itself once none is left, instead of falling to the page; the hints region announces the hint.
  React.useEffect(() => {
    if (session.visibleHintCount === 0) return;
    (hintButton.current ?? latestHint.current)?.focus();
  }, [session.visibleHintCount]);

  // "Lock in answer" disables while it checks; when the check fails, focus returns to it beside the alert.
  React.useEffect(() => {
    if (error !== null && !busy) answerButton.current?.focus();
  }, [error, busy]);

  const submit = async () => {
    if (selection === "" || session.reveal !== null || busy || ended || hintPending.current) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizeRevealAction({ sessionToken: token.current, roundId: round.roundId, candidateId: selection });
      if (!response.ok) {
        if (response.reason === "SESSION_ENDED") setEnded(true);
        else setError("Couldn’t check that answer. Try again.");
        return;
      }
      const result = projectDisplayReveal(response.reveal);
      const locked = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: selection });
      setSession(transitionArcadeSession(mode, locked, { type: "accept-reveal", reveal: result }));
      token.current = response.sessionToken;
    } catch {
      setError("Couldn’t check that answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // The button stays enabled while its hint loads, so keyboard focus is never dropped; a second press waits.
  const requestHint = async () => {
    if (hintPending.current || busy || ended || session.lockedCandidateId !== null) return;
    hintPending.current = true;
    setHintLoading(true);
    setHintError(null);
    try {
      const response = await revealHintAction({ sessionToken: token.current, roundId: round.roundId });
      if (!response.ok) {
        if (response.reason === "SESSION_ENDED") setEnded(true);
        else setHintError("Couldn’t get that hint. Try again.");
        return;
      }
      setSession((current) => transitionArcadeSession(mode, current, { type: "reveal-hint", label: response.hint, detail: response.detail ?? null }));
      token.current = response.sessionToken;
    } catch {
      setHintError("Couldn’t get that hint. Try again.");
    } finally {
      hintPending.current = false;
      setHintLoading(false);
    }
  };

  const next = () => {
    setSession((current) => transitionArcadeSession(mode, current, { type: "next-round" }));
    setSelection("");
    setFocusedCandidate(null);
    setError(null);
    setHintError(null);
  };

  return (
    <main className="arcade-shell" data-round-count={mode.rounds.length}>
      <noscript>This game needs JavaScript for answers and progressive evidence.</noscript>
      <ArcadeHeader score={session.score}>
        <RoundTrack rounds={mode.rounds} roundIndex={session.roundIndex} outcomes={session.outcomes} />
      </ArcadeHeader>

      <section className="game-card" aria-labelledby="round-title" data-round-id={round.roundId}>
        <p className="eyebrow">Round {session.roundIndex + 1} of {mode.rounds.length}</p>
        <h1 id="round-title" ref={roundTitle} tabIndex={-1}>{round.mode.prompt}</h1>
        {round.scaffold && <QuestionScaffold scaffold={round.scaffold} />}
        <CodePanes round={round} numbered={numbered} paneLines={paneLines} highlighted={highlighted} marked={markedLines(session.hintDetails)} />

        <HintBar round={round} hints={session.hints} details={session.hintDetails} disabled={busy || ended || session.lockedCandidateId !== null}
          error={hintError} onRequest={requestHint} buttonRef={hintButton} latestHintRef={latestHint} />

        <AnswerOptions round={round} numbered={numbered && round.mode.kind === "fix"} paneLines={paneLines} selection={selection}
          answerCandidateId={session.reveal?.answerCandidateId ?? null} lockedCandidateId={session.lockedCandidateId}
          disabled={session.reveal !== null || busy} onSelect={setSelection} onFocusCandidate={setFocusedCandidate} />

        <button className="answer-button" type="button" ref={answerButton} disabled={selection === "" || session.reveal !== null || busy || ended || hintLoading} onClick={submit}>
          {busy ? "Checking…" : "Lock in answer"}
        </button>
        {error && <p className="demo-error" role="alert">{error}</p>}
        {ended && (
          <p className="demo-error" role="alert">
            {SESSION_ENDED_MESSAGE}{newGameHref && <> <a href={newGameHref}>Deal new rounds</a></>}
          </p>
        )}

        <div className="reveal" aria-live="polite" aria-atomic="true">
          {session.reveal && (
            <RoundReveal round={round} reveal={session.reveal} hintsUsed={session.visibleHintCount}
              pickLabel={labelOf(session.lockedCandidateId)} complete={session.status === "complete"}
              correctRounds={session.correctRounds} history={session.history} deckTitle={deckTitle} newGameHref={newGameHref}
              chooseAnotherDeckHref={chooseAnotherDeckHref} genuiDesign={genuiDesign} sessionToken={currentToken}
              onNext={next} headingRef={revealHeading} track={track} trackGenui={trackGenui} />
          )}
        </div>
      </section>
      {genuiDesign === "host" && (
        <React.Suspense fallback={null}>
          <HostChat key={round.roundId} roundId={round.roundId} phase={session.reveal ? "after-lock" : "before-lock"}
            panes={round.content.panes} optionLabels={round.mode.candidates.map(({ label }) => label)} sessionToken={currentToken}
            hint={{
              label: session.lockedCandidateId !== null || session.visibleHintCount >= round.mode.clues.length ? null
                : `Buy hint ${session.visibleHintCount + 1} (−${points(round.points[session.visibleHintCount]! - round.points[session.visibleHintCount + 1]!)} pts)`,
              buy: () => { trackGenui({ type: "genui_interaction", action: "offer_hint" }); void requestHint(); },
            }} onEvent={trackGenui} />
        </React.Suspense>
      )}
    </main>
  );
}
