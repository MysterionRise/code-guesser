import * as React from "react";

import type { ClientEvent, GenuiEvent } from "../../experiment/events";
import { hostInputId, type Design } from "../../genui/designs";
import type { GenuiPanelProps } from "../../genui/genui-panel";
import type { ChallengerDuel, GameDuel } from "../duel/duel-contract";
import { ChallengeFriend, DuelCompletion } from "../duel/duel-game";
import { DEFAULT_NAME, opponentRoundLine } from "../duel/duel-text";
import type { AuthorizedReveal, EntertainmentResultProjection, RoundRecord } from "./arcade-session";
import { formatCompletionResult, points, projectSpoilerFreeShare, roundPointsNote } from "./arcade-text";
import type { PublicRound } from "./mode-contract";
import { hasShareSheet, shareOrCopy } from "./share-sheet";

const SOURCE_LINK = /(https:\/\/\S+)/u;

/** Renders the public attribution with its source address as a link; the text itself is unchanged. */
const linkedAttribution = (attribution: string): React.ReactNode[] => attribution.split(SOURCE_LINK)
  .map((part, index) => index % 2 === 1
    ? <a key={index} href={part} rel="noreferrer noopener" target="_blank">{part}</a>
    : part);

/** Generative UI's panel, fetched only when the server turns it on, so the static game never loads it. */
const GenuiPanel = React.lazy(() => import("../../genui/genui-panel")) as React.ComponentType<GenuiPanelProps>;

/** A label that may break after each slash on a narrow screen, so `owner/name` never splits inside a word. */
const breakable = (label: string): React.ReactNode[] => label.split("/").flatMap((part, index) => index === 0 ? [part] : [<wbr key={index} />, `/${part}`]);

/**
 * "Your game" (#43): every round's pick, answer, points, and source, and the total against the most it could earn. A
 * mixed game's rounds each name their deck (#161), since picks like "Line 7" read alike across decks.
 */
function GameSummary({ history, result, roundDecks }: {
  readonly history: readonly RoundRecord[];
  readonly result: EntertainmentResultProjection;
  readonly roundDecks: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <section className="game-summary" aria-labelledby="game-summary-title">
      <h3 id="game-summary-title">Your game</h3>
      <table className={roundDecks ? "with-decks" : undefined}>
        <thead>
          <tr>
            <th scope="col"><abbr title="Round">#</abbr></th>{roundDecks && <th scope="col">Deck</th>}<th scope="col">Your pick</th><th scope="col">Answer</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry, index) => (
            <tr key={entry.roundId} className={entry.correct ? "summary-right" : "summary-missed"}>
              <th scope="row">
                {entry.source ? <a href={entry.source} rel="noreferrer noopener" target="_blank">{index + 1}<span className="visually-hidden"> (source)</span></a> : index + 1}
              </th>
              {roundDecks && <td className="summary-deck">{roundDecks[entry.deck] ?? entry.deck}</td>}
              <td className="summary-pick"><span aria-hidden="true">{entry.correct ? "✓ " : "✗ "}</span>{breakable(entry.picked)}<span className="visually-hidden">{entry.correct ? ", right" : ", missed"}</span></td>
              <td>{breakable(entry.answer)}</td>
              <td>{points(entry.points)}{entry.hints > 0 && <span className="summary-hints"> ({entry.hints === 1 ? "1 hint" : `${entry.hints} hints`})</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row" colSpan={roundDecks ? 3 : 2}>Total</th><td colSpan={2}>{points(result.score)} of {points(result.attainableMaximum)}</td></tr></tfoot>
      </table>
    </section>
  );
}

/**
 * Where a finished game can go next, and its spoiler-free share line (#171): through the browser's share sheet where
 * it has one, otherwise onto the clipboard. A status line says which, for screen readers too. A game of a seeded deal
 * or of today's five can also challenge a friend (#173), and today's five can be played again (#172).
 */
function CompletionActions({ result, correctRounds, history, deckTitle, shareHref, newGameHref, replayHref, chooseAnotherDeckHref, challenge, sessionToken, track }: {
  readonly result: EntertainmentResultProjection;
  readonly correctRounds: number;
  readonly history: readonly RoundRecord[];
  readonly deckTitle: string | undefined;
  readonly shareHref: string | undefined;
  readonly newGameHref: string | undefined;
  readonly replayHref: string | undefined;
  readonly chooseAnotherDeckHref: string | undefined;
  readonly challenge: ChallengerDuel | undefined;
  readonly sessionToken: () => string;
  readonly track: (event: ClientEvent) => void;
}) {
  const sheet = hasShareSheet();
  const [status, setStatus] = React.useState("");
  const shareResult = async () => {
    const share = projectSpoilerFreeShare(result, history, deckTitle, shareHref);
    const outcome = await shareOrCopy(share.url === null ? { text: share.message } : { text: share.message, url: share.url }, share.text);
    if (outcome === "shared" || outcome === "copied") {
      setStatus(outcome === "shared" ? "Result shared" : "Result copied");
      track({ type: "result_shared", via: outcome === "shared" ? "share" : "clipboard" });
    } else if (outcome === "failed") {
      setStatus("Couldn’t copy the result. Try again.");
    }
  };
  return (
    <>
      <p>{formatCompletionResult(result, correctRounds)}</p>
      <div className="completion-actions">
        {newGameHref && <a className="primary-action" href={newGameHref} onClick={() => track({ type: "deal_again", to: "same-deck" })}>Deal new rounds</a>}
        <button className="secondary-action" type="button" onClick={shareResult}>{sheet ? "Share result" : "Copy result"}</button>
        {replayHref && <a className="deck-link" href={replayHref} onClick={() => track({ type: "deal_again", to: "same-deck" })}>Play again</a>}
        {chooseAnotherDeckHref && <a className="deck-link" href={chooseAnotherDeckHref} onClick={() => track({ type: "deal_again", to: "chooser" })}>Choose another deck</a>}
      </div>
      <p className="share-status" role="status">{status}</p>
      {challenge && <ChallengeFriend duel={challenge} sessionToken={sessionToken} track={track} />}
    </>
  );
}

/**
 * A revealed round (#126): the verdict, what it earned, and the answer first, with a way to the host's chat when the
 * host is on (#161); on the last round the game's summary and the way on right after; then why, which folds away once
 * a generative explainer has rendered (#121); then the explainer, the round's source, and the next round. The parent
 * renders it only after the server authorized the reveal. In a friend's game of a challenge (#173), it also says how
 * the challenger did on this round, and the game ends on the duel's comparison instead of the usual way on.
 */
export function RoundReveal({ round, reveal, hintsUsed, pickLabel, complete, correctRounds, history, deckTitle, roundDecks, shareHref, newGameHref, replayHref, chooseAnotherDeckHref, genuiDesign, duel, opponentName, sessionToken, onNext, headingRef, track, trackGenui }: {
  readonly round: Readonly<PublicRound>;
  readonly reveal: AuthorizedReveal;
  readonly hintsUsed: number;
  /** The option the player locked in. */
  readonly pickLabel: string;
  readonly complete: boolean;
  readonly correctRounds: number;
  /** Every answered round so far, for the summary once the game is complete. */
  readonly history: readonly RoundRecord[];
  readonly deckTitle: string | undefined;
  /** Each deck's title by round kind, in a mixed game, so its summary names each round's deck. */
  readonly roundDecks: Readonly<Record<string, string>> | undefined;
  /** The finished game's own address, which its share line links to. */
  readonly shareHref: string | undefined;
  readonly newGameHref: string | undefined;
  /** Today's five again, recording nothing (#172). */
  readonly replayHref: string | undefined;
  readonly chooseAnotherDeckHref: string | undefined;
  readonly genuiDesign: Design | undefined;
  readonly duel: GameDuel | undefined;
  /** The challenger's name, from the challenge link, in a friend's game; null when the link names no one. */
  readonly opponentName: string | null;
  readonly sessionToken: () => string;
  readonly onNext: () => void;
  readonly headingRef: React.Ref<HTMLHeadingElement>;
  /** Reports browser-only events to the event log (#107). */
  readonly track: (event: ClientEvent) => void;
  readonly trackGenui: (event: GenuiEvent) => void;
}) {
  const answer = round.mode.candidates.find(({ candidateId }) => candidateId === reveal.answerCandidateId)?.label;
  const [whyOpen, setWhyOpen] = React.useState(true);
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className={reveal.correct ? "verdict-right" : "verdict-missed"}>{reveal.correct ? "Nice read." : "Not this time."}</h2>
      <p className="round-points">{roundPointsNote(reveal.score, hintsUsed)}</p>
      {duel?.role === "challenged" && (
        <p className="duel-line">{opponentRoundLine(opponentName ?? DEFAULT_NAME, duel.challenge.challenger.rounds[history.length - 1]!)}</p>
      )}
      <p className="answer-line">The answer: <strong>{answer}</strong></p>
      {/* The host's chat sits below the round (#161): this moves focus to it, and leaves the address alone, since its
          fragment may name a duel's players (#173). */}
      {genuiDesign === "host" && (
        <p className="host-cue">
          <a href={`#${hostInputId(round.roundId)}`}
            onClick={(event) => { event.preventDefault(); document.getElementById(hostInputId(round.roundId))?.focus(); }}>Ask the host about this round</a>
        </p>
      )}
      {complete && (
        <>
          <GameSummary history={history} result={reveal.result} roundDecks={roundDecks} />
          {duel?.role === "challenged"
            ? <DuelCompletion duel={duel} name={opponentName} sessionToken={sessionToken} chooseAnotherDeckHref={chooseAnotherDeckHref} track={track} />
            : (
              <CompletionActions result={reveal.result} correctRounds={correctRounds} history={history} deckTitle={deckTitle} shareHref={shareHref}
                newGameHref={newGameHref} replayHref={replayHref} chooseAnotherDeckHref={chooseAnotherDeckHref} challenge={duel} sessionToken={sessionToken}
                track={track} />
            )}
        </>
      )}
      <details className="reveal-why" open={whyOpen} onToggle={(event) => setWhyOpen(event.currentTarget.open)}>
        <summary>Why it’s {answer}</summary>
        <p>{reveal.evidence}</p>
        <p>{reveal.explanation}</p>
        <p>Helpful signals: {reveal.helpfulSignals.join(" · ")}</p>
        <p>Misleading signals: {reveal.misleadingSignals.join(" · ")}</p>
      </details>
      {genuiDesign && genuiDesign !== "host" && (
        <React.Suspense fallback={null}>
          <GenuiPanel key={round.roundId} design={genuiDesign} roundId={round.roundId} phase="after-lock" panes={round.content.panes}
            pick={{ label: pickLabel, correct: reveal.correct }}
            optionLabels={round.mode.candidates.map(({ label }) => label)} sessionToken={sessionToken} onEvent={trackGenui}
            onRendered={() => setWhyOpen(false)} />
        </React.Suspense>
      )}
      <small className="reveal-source">{linkedAttribution(reveal.attribution)}</small>
      {!complete && <button type="button" onClick={onNext}>Next round</button>}
    </>
  );
}
