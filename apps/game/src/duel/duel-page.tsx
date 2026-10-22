import type { Metadata } from "next";
import * as React from "react";

import { authorizeLocalExperimentReveal, issueDuelResult, revealLocalExperimentHint } from "../app/actions";
import { points } from "../components/arcade/arcade-text";
import type { DuelRefusalReason } from "../components/duel/duel-contract";
import { ChallengeIntro, DuelResult } from "../components/duel/duel-pages";
import { duelDeckTitle, sideLine } from "../components/duel/duel-text";
import { DemoArcade } from "../demo/demo-arcade";
import { gameSources } from "../demo/game-sources.server";
import { DAILY_DECK, MIXED_DECK } from "../demo/local-real-experiment-domain.server";
import type { LocalRealExperiment } from "../demo/local-real-experiment.server";
import { PageFrame } from "../demo/page-frame";
import { CONTROL, type Level } from "../experiment/arms";

/**
 * A duel's pages (#173): a challenge's intro, the friend's game of it, and a result. Each reads its link's token
 * through the experiment, which refuses anything it didn't seal; names stay in the link's fragment, so nothing here
 * ever sees one.
 */

/** A duel's address: a challenge's intro (`?duel=`), the friend's game of it (`&play=1`), or a result (`?duel-result=`). */
export type DuelRequest = Readonly<{ kind: "intro" | "play" | "result"; token: string }>;

type Query = Readonly<Record<string, string | string[] | undefined>>;

/** The duel a page's address names, if any; its token is checked only as it is opened. */
export const duelRequest = (query: Query): DuelRequest | null =>
  typeof query["duel-result"] === "string" ? { kind: "result", token: query["duel-result"] }
    : typeof query.duel === "string" ? { kind: query.play === "1" ? "play" : "intro", token: query.duel }
      : null;

/**
 * A duel's page is never indexed: its link is for a friend. A challenge's preview names its deck and the total to beat
 * and shows the deck's image (#171); it deals nothing, and it never sees a name, which only the fragment carries.
 */
export const duelMetadata = (request: DuelRequest, experiment: LocalRealExperiment): Metadata => {
  const robots = { index: false, follow: false };
  const opened = request.kind === "result" ? null : experiment.openChallenge(request.token);
  if (!opened?.ok) return { title: "A duel · CodeGuessr", robots };
  const { challenge } = opened;
  const title = `Duel: ${duelDeckTitle(challenge)} · CodeGuessr`;
  const description = `Play the same five rounds, and beat ${points(challenge.challenger.score)} of ${points(challenge.max)}.`;
  return {
    title, description, robots,
    openGraph: {
      type: "website", siteName: "CodeGuessr", title, description,
      images: [{ url: `/og/${challenge.deck}`, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image" },
  };
};

/** What a refused challenge link says; a link for rounds this server no longer deals can't be played. */
const CHALLENGE_REFUSALS: Readonly<Record<DuelRefusalReason, string>> = Object.freeze({
  INVALID: "This challenge link isn’t valid.",
  EXPIRED: "This challenge has expired.",
  ROUND_SET: "This challenge was for an earlier round set. Its rounds are gone.",
  DEAL_DRIFT: "This challenge was for an earlier round set. Its rounds are gone.",
  NOT_ELIGIBLE: "This challenge link isn’t valid.",
  SESSION_ENDED: "This challenge link isn’t valid.",
});

/** A refused link: why, and a fresh deal of its deck when the refusal names one this server still offers. */
function DuelRefused({ message, deck }: { readonly message: string; readonly deck: Readonly<{ id: string; title: string }> | undefined }) {
  return (
    <main className="duel-page" aria-labelledby="duel-title">
      <section className="game-card">
        <p className="eyebrow">CodeGuessr duel</p>
        <h1 id="duel-title">{message}</h1>
        {deck && <p className="duel-deck">{deck.title}</p>}
        <div className="completion-actions">
          {deck && <a className="primary-action" href={`/?deck=${deck.id}`}>Deal new rounds</a>}
          <a className="deck-link" href="/">Choose another deck</a>
        </div>
      </section>
    </main>
  );
}

const DuelNav = () => <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>;

/**
 * The page a duel link names. The intro deals nothing and plays in the challenger's theme. The friend's game is dealt
 * from the challenge under the challenger's arms, so a lab tester's picks and the lab bar have no place in it, and its
 * new rounds are a fresh deal of the deck, never the challenger's next game. A result, like a refused link, is outside
 * any game, so it keeps the original theme unless a lab tester picks one.
 */
export function DuelPage({ request, experiment, record, origin, labTheme }: {
  readonly request: DuelRequest;
  readonly experiment: LocalRealExperiment;
  /** Whether the friend's game may record events; until events v2 a duel game records none. */
  readonly record: boolean;
  readonly origin: string | null;
  readonly labTheme: Level<"theme"> | undefined;
}) {
  const sources = gameSources(experiment);
  const sourceOf = (deck: string | undefined) => sources.find(({ id }) => id === deck);
  const outside = labTheme ?? CONTROL.theme;
  const refused = (message: string, deck?: string) => (
    <PageFrame theme={outside}><DuelNav /><DuelRefused message={message} deck={sourceOf(deck)} /></PageFrame>
  );

  if (request.kind === "result") {
    const opened = experiment.openResult(request.token);
    if (!opened.ok) return refused(opened.reason === "EXPIRED" ? "This result has expired." : "This result link isn’t valid.");
    const { comparison } = opened;
    return (
      <PageFrame theme={outside}>
        <DuelNav />
        <DuelResult comparison={comparison} dealHref={sourceOf(comparison.deck) ? `/?deck=${comparison.deck}` : null} chooseAnotherDeckHref="/" />
      </PageFrame>
    );
  }
  if (request.kind === "intro") {
    const opened = experiment.openChallenge(request.token);
    if (!opened.ok) return refused(CHALLENGE_REFUSALS[opened.reason], opened.deck);
    const { challenge } = opened;
    return (
      <PageFrame theme={challenge.theme}>
        <DuelNav />
        <ChallengeIntro deck={duelDeckTitle(challenge)} total={sideLine(challenge.challenger, challenge.max)} firstPlay={challenge.challenger.firstPlay}
          playHref={`/?duel=${request.token}&play=1`} chooseAnotherDeckHref="/" />
      </PageFrame>
    );
  }
  const dealt = experiment.dealChallenge(request.token, Date.now(), record);
  if (!dealt.ok) return refused(CHALLENGE_REFUSALS[dealt.reason], dealt.deck);
  const { game, challenge } = dealt;
  // A rematch is a fresh deal of the deck; today's five deals one game a day, so its rematch is a mix.
  const rematchHref = `/?deck=${challenge.deck === DAILY_DECK ? MIXED_DECK : challenge.deck}`;
  // A mixed game names each round's deck, as it does outside a duel.
  const roundDecks = challenge.deck === MIXED_DECK || challenge.deck === DAILY_DECK
    ? Object.fromEntries(experiment.decks.map(({ id, title }) => [id, title])) : undefined;
  return (
    <PageFrame theme={game.arms.theme}>
      <DuelNav />
      <DemoArcade key={game.sessionToken} mode={game.mode} sessionToken={game.sessionToken} deckTitle={duelDeckTitle(challenge)}
        {...(roundDecks ? { roundDecks } : {})} authorizeRevealAction={authorizeLocalExperimentReveal} revealHintAction={revealLocalExperimentHint}
        chooseAnotherDeckHref="/" newGameHref={rematchHref}
        duel={{ role: "challenged", origin, challengeToken: request.token, challenge, rematchHref, issueResult: issueDuelResult }}
        {...(game.arms.design === "off" ? {} : { genuiDesign: game.arms.design })} />
    </PageFrame>
  );
}
