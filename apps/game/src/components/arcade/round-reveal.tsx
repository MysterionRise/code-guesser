import * as React from "react";

import type { Design } from "../../genui/designs";
import type { GenuiPanelProps } from "../../genui/genui-panel";
import type { AuthorizedReveal, EntertainmentResultProjection } from "./arcade-session";
import { formatCompletionResult, projectSpoilerFreeShare, roundPointsNote } from "./arcade-text";
import type { PublicRound } from "./mode-contract";

const SOURCE_LINK = /(https:\/\/\S+)/u;

/** Renders the public attribution with its source address as a link; the text itself is unchanged. */
const linkedAttribution = (attribution: string): React.ReactNode[] => attribution.split(SOURCE_LINK)
  .map((part, index) => index % 2 === 1
    ? <a key={index} href={part} rel="noreferrer noopener" target="_blank">{part}</a>
    : part);

/** Generative UI's panel, fetched only when the server turns it on, so the static game never loads it. */
const GenuiPanel = React.lazy(() => import("../../genui/genui-panel")) as React.ComponentType<GenuiPanelProps>;

/** Where a finished game can go next, and its spoiler-free share line. */
function CompletionActions({ result, correctRounds, deckTitle, newGameHref, chooseAnotherDeckHref }: {
  readonly result: EntertainmentResultProjection;
  readonly correctRounds: number;
  readonly deckTitle: string | undefined;
  readonly newGameHref: string | undefined;
  readonly chooseAnotherDeckHref: string | undefined;
}) {
  const [copied, setCopied] = React.useState(false);
  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(projectSpoilerFreeShare(result, correctRounds, deckTitle).text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <p>{formatCompletionResult(result, correctRounds, deckTitle)}</p>
      <div className="completion-actions">
        {newGameHref && <a className="primary-action" href={newGameHref}>Deal new rounds</a>}
        <button className="secondary-action" type="button" onClick={copyResult}>{copied ? "Copied" : "Copy result"}</button>
        {chooseAnotherDeckHref && <a className="deck-link" href={chooseAnotherDeckHref}>Choose another deck</a>}
      </div>
    </>
  );
}

/**
 * A revealed round: the verdict, what it earned, the answer and why, its source, the generative panel when the
 * server turns one on, and the way on. The parent renders it only after the server authorized the reveal.
 */
export function RoundReveal({ round, reveal, hintsUsed, pickLabel, complete, correctRounds, deckTitle, newGameHref, chooseAnotherDeckHref, genuiDesign, sessionToken, onNext, headingRef }: {
  readonly round: Readonly<PublicRound>;
  readonly reveal: AuthorizedReveal;
  readonly hintsUsed: number;
  /** The option the player locked in. */
  readonly pickLabel: string;
  readonly complete: boolean;
  readonly correctRounds: number;
  readonly deckTitle: string | undefined;
  readonly newGameHref: string | undefined;
  readonly chooseAnotherDeckHref: string | undefined;
  readonly genuiDesign: Design | undefined;
  readonly sessionToken: () => string;
  readonly onNext: () => void;
  readonly headingRef: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className={reveal.correct ? "verdict-right" : "verdict-missed"}>{reveal.correct ? "Nice read." : "Not this time."}</h2>
      <p className="round-points">{roundPointsNote(reveal.score, hintsUsed)}</p>
      <p className="answer-line">The answer: <strong>{round.mode.candidates.find(({ candidateId }) => candidateId === reveal.answerCandidateId)?.label}</strong></p>
      <p>{reveal.evidence}</p>
      <p>{reveal.explanation}</p>
      <p>Helpful signals: {reveal.helpfulSignals.join(" · ")}</p>
      <p>Misleading signals: {reveal.misleadingSignals.join(" · ")}</p>
      <small>{linkedAttribution(reveal.attribution)}</small>
      {genuiDesign && genuiDesign !== "host" && (
        <React.Suspense fallback={null}>
          <GenuiPanel key={round.roundId} design={genuiDesign} roundId={round.roundId} phase="after-lock" panes={round.content.panes}
            pick={{ label: pickLabel, correct: reveal.correct }}
            optionLabels={round.mode.candidates.map(({ label }) => label)} sessionToken={sessionToken} />
        </React.Suspense>
      )}
      {!complete
        ? <button type="button" onClick={onNext}>Next round</button>
        : <CompletionActions result={reveal.result} correctRounds={correctRounds} deckTitle={deckTitle}
            newGameHref={newGameHref} chooseAnotherDeckHref={chooseAnotherDeckHref} />}
    </>
  );
}
