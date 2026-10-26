"use client";

import * as React from "react";

import { DuelComparisonTable } from "./duel-comparison";
import type { DuelComparison, FirstPlay } from "./duel-contract";
import { useFragmentNames } from "./duel-names";
import { DEFAULT_NAME, RESULT_NAMES, duelDeckTitle, firstPlayNote, nameFragment } from "./duel-text";

/**
 * A duel's two pages that name its players (#173). Names come only from the link's fragment, which the browser never
 * sends, so the server renders the fallbacks and the browser puts the names in as it hydrates.
 */

/**
 * A challenge's intro: who challenges, on which deck, the total to beat, and whether it was the challenger's first try.
 * It deals nothing, so a link preview never starts a game; "Play the same five" does, keeping the fragment's name.
 */
export function ChallengeIntro({ deck, total, firstPlay, playHref, chooseAnotherDeckHref }: {
  /** The deck, or today's five with its date. */
  readonly deck: string;
  /** How the challenger did in all, such as "3/5 right · 3,300 of 5,000". */
  readonly total: string;
  readonly firstPlay: FirstPlay;
  readonly playHref: string;
  readonly chooseAnotherDeckHref: string;
}) {
  const { from } = useFragmentNames();
  const name = from ?? DEFAULT_NAME;
  const note = firstPlayNote(firstPlay, name);
  return (
    <main className="duel-page" aria-labelledby="duel-title">
      <section className="game-card">
        <p className="eyebrow">CodeGuessr duel</p>
        <h1 id="duel-title"><bdi>{name}</bdi> challenges you</h1>
        <p className="duel-deck">{deck}</p>
        <p className="duel-total">{total}</p>
        {note && <p className="duel-badge">{note}</p>}
        <p className="duel-intro">You play the same five rounds, with the same hints. Each of their rounds shows once you’ve answered it.</p>
        <div className="completion-actions">
          <a className="primary-action" href={`${playHref}${nameFragment({ from })}`}>Play the same five</a>
          <a className="deck-link" href={chooseAnotherDeckHref}>Choose another deck</a>
        </div>
      </section>
    </main>
  );
}

/**
 * A result link, read-only: both games side by side and the verdict, which the server works out again on every visit.
 * It names no round or answer, so it can show after the rounds it was played on are gone.
 */
export function DuelResult({ comparison, dealHref, chooseAnotherDeckHref }: {
  readonly comparison: DuelComparison;
  /** A fresh deal of the duel's deck, while this round set offers it. */
  readonly dealHref: string | null;
  readonly chooseAnotherDeckHref: string;
}) {
  const { from, vs } = useFragmentNames();
  const names = { challenger: from ?? RESULT_NAMES.challenger, challenged: vs ?? RESULT_NAMES.challenged };
  return (
    <main className="duel-page" aria-labelledby="duel-title">
      <section className="game-card">
        <p className="eyebrow">CodeGuessr duel</p>
        <h1 id="duel-title"><bdi>{names.challenged}</bdi> vs <bdi>{names.challenger}</bdi></h1>
        <p className="duel-deck">{duelDeckTitle(comparison)}</p>
        {comparison.earlierRoundSet && <p className="duel-note">Played on an earlier round set, whose rounds are gone.</p>}
        <DuelComparisonTable comparison={comparison} names={names} level={2} />
        <div className="completion-actions">
          {dealHref && <a className="primary-action" href={dealHref}>Deal new rounds</a>}
          <a className="deck-link" href={chooseAnotherDeckHref}>Choose another deck</a>
        </div>
      </section>
    </main>
  );
}
