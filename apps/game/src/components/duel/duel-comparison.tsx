import * as React from "react";

import { points } from "../arcade/arcade-text";
import type { DuelComparison, DuelRound, DuelSide } from "./duel-contract";
import { firstPlayNote, hintWords, playNote, sideName, verdictWords, type DuelNames } from "./duel-text";

/** One side's round: ✓ or ✗, said in words too, then its points and any hints. */
function RoundCell({ round: [correct, hints, scored] }: { readonly round: DuelRound }) {
  return (
    <td className={correct ? undefined : "duel-missed"}>
      <span aria-hidden="true">{correct ? "✓ " : "✗ "}</span>{points(scored)}<span className="visually-hidden">{correct ? ", right" : ", missed"}</span>
      {hints > 0 && <span className="summary-hints"> ({hintWords(hints)})</span>}
    </td>
  );
}

/** One side's totals: its score, then its rounds right and hints. */
function TotalCell({ side }: { readonly side: DuelSide }) {
  return <td>{points(side.score)}<span className="summary-hints"> ({side.correct} right, {hintWords(side.hints)})</span></td>;
}

/**
 * A duel's comparison (#173): the server's verdict, what decided it when the points were level, which play of the deal
 * each side's was, then both games round by round with their totals, the friend's first. It reuses the game summary's
 * table, and names no option or answer: a duel holds none.
 */
export function DuelComparisonTable({ comparison, names, level }: {
  readonly comparison: DuelComparison;
  readonly names: DuelNames;
  /** The verdict's heading level: 3 under a game's reveal, 2 on a result page. */
  readonly level: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const { challenger, challenged } = comparison;
  const { heading, tieBreak } = verdictWords(comparison, names);
  const [friend, rival] = [sideName(names, "challenged"), sideName(names, "challenger")];
  const notes = [tieBreak, firstPlayNote(challenger.firstPlay, rival, true), playNote(challenged.play, names.challenged)]
    .filter((note): note is string => note !== null);
  return (
    <section className="game-summary duel-comparison" aria-labelledby="duel-verdict">
      <Heading id="duel-verdict">{heading}</Heading>
      {notes.map((note) => <p className="duel-note" key={note}>{note}</p>)}
      <table>
        <caption>Both games, round by round</caption>
        <thead>
          <tr><th scope="col"><abbr title="Round">#</abbr></th><th scope="col"><bdi>{friend}</bdi></th><th scope="col"><bdi>{rival}</bdi></th></tr>
        </thead>
        <tbody>
          {challenged.rounds.map((round, index) => (
            <tr key={index}><th scope="row">{index + 1}</th><RoundCell round={round} /><RoundCell round={challenger.rounds[index]!} /></tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row">Total</th><TotalCell side={challenged} /><TotalCell side={challenger} /></tr></tfoot>
      </table>
    </section>
  );
}
