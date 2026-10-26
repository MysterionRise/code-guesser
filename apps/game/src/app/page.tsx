import { randomBytes } from "node:crypto";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeLocalExperimentReveal, createDuelChallenge, revealLocalExperimentHint } from "./actions";
import { recordsArtifact } from "../components/arcade/local-records";
import { ClearRecords, DayStreak, DeckRecord } from "../components/chooser-records";
import { DailyCard, DailyRedirect } from "../components/daily-link";
import { ArtifactUnavailable } from "../demo/artifact-unavailable";
import { DemoArcade } from "../demo/demo-arcade";
import { DAILY_DESCRIPTION, DAILY_TITLE, gameSources, type GameSource } from "../demo/game-sources.server";
import { activeLocalRealExperiment } from "../demo/local-real-experiment-loader.server";
import { DEAL_SEED, MAXIMUM_GAME, dailyDateOf, type DealSeries } from "../demo/local-real-experiment-deal.server";
import type { DailyDeal, LocalRealDeck, LocalRealMix } from "../demo/local-real-experiment.server";
import { DAILY_DECK, MIXED_DECK, type SessionDeckId } from "../demo/local-real-experiment-domain.server";
import { PageFrame } from "../demo/page-frame";
import { DuelPage, duelMetadata, duelRequest } from "../duel/duel-page";
import { CONTROL, FACTORS, assignArms, labMode, labOverrides, parseDisabled, type Arms, type Level } from "../experiment/arms";
import { DESIGN_LABELS, READY_DESIGNS, type Design } from "../genui/designs";
import { clientKey } from "../server/client-key.server";
import { publicOrigin } from "../server/public-origin.server";
import { limited } from "../server/rate-limit.server";

const DECK_COUNT_WORDS = ["No decks", "One deck", "Two decks", "Three decks", "Four decks", "Five decks", "Six decks", "Seven decks",
  "Eight decks", "Nine decks", "Ten decks", "Eleven decks", "Twelve decks"] as const;
/** A run publishes every deck it could fill, so the chooser counts what this artifact holds. */
const deckSummary = (count: number): string => `${DECK_COUNT_WORDS[count] ?? `${count} decks`} to choose from.`;

/** What a deck asks of a player: to recognise where code comes from, or to reason about what it does. */
const DECK_TAGS: Readonly<Record<string, string>> = Object.freeze({
  project: "Recognise", language: "Recognise", algorithm: "Recognise", "before-after": "Reason", output: "Reason", fix: "Reason",
  "missing-line": "Reason",
  "name-function": "Reason",
  framework: "Recognise",
  exercise: "Recognise",
  "vulnerable-line": "Reason",
});

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

/** The deck, mix, or today's five a page's address names, when this artifact offers it. */
const requestedSource = (requested: string | string[] | undefined): GameSource | undefined => {
  const loaded = activeLocalRealExperiment();
  return !loaded.ok || typeof requested !== "string" ? undefined : gameSources(loaded.experiment).find(({ id }) => id === requested);
};

/**
 * A deck's title, description, and link preview (#171), from what its deck publishes and never from a round; the
 * chooser keeps the layout's. The preview is an image of the deck's title (`app/og/[deck]/route.tsx`). A duel's page
 * is never indexed (#173).
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const query = await searchParams;
  const origin = publicOrigin(await headers());
  const base: Metadata = origin === null ? {} : { metadataBase: new URL(origin) };
  const loaded = activeLocalRealExperiment();
  const duel = duelRequest(query);
  if (loaded.ok && duel !== null) return { ...base, ...duelMetadata(duel, loaded.experiment) };
  const source = requestedSource(query.deck);
  if (source === undefined) return base;
  const title = `${source.title} · CodeGuessr`;
  return {
    ...base,
    title,
    description: source.description,
    openGraph: {
      type: "website", siteName: "CodeGuessr", title, description: source.description,
      images: [{ url: `/og/${source.id}`, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image" },
  };
}

/**
 * The chooser (#126): the mix first when the artifact offers one (#56), then decks grouped by what they ask; in lab
 * mode `query` carries the tester's picks onto each link. Each card shows the player's records for it, which only their
 * browser holds (#63), under this round set's `artifact`.
 */
function DeckChooser({ decks, mixed, query, artifact }: {
  readonly decks: readonly LocalRealDeck[]; readonly mixed: LocalRealMix | null; readonly query: string; readonly artifact: string;
}) {
  const groups = (["Recognise", "Reason"] as const).map((tag) => ({ tag, decks: decks.filter(({ id }) => (DECK_TAGS[id] ?? "Reason") === tag) }))
    .filter(({ decks: grouped }) => grouped.length > 0);
  return (
    <main className="deck-chooser" aria-labelledby="deck-chooser-title">
      <h1 id="deck-chooser-title">Pick a deck</h1>
      <p className="deck-intro">
        {deckSummary(decks.length)} Each game deals five real rounds from the deck. Read the code, take up to two hints,
        and lock in your guess.
      </p>
      {mixed && (
        <section className="deck-group" aria-labelledby="deck-group-mixed">
          <h2 id="deck-group-mixed" className="deck-group-title">Mixed<span className="deck-group-note">A taste of every kind.</span></h2>
          <ul className="deck-list">
            <li><DailyCard title={DAILY_TITLE} description={DAILY_DESCRIPTION} query={query}><DayStreak artifact={artifact} /></DailyCard></li>
            <li>
              <a className="deck-card" href={`/?deck=${MIXED_DECK}${query}`}>
                <span className="deck-title">{mixed.title}</span>{" "}
                <span className="deck-description">{mixed.description}</span>{" "}
                <span className="deck-size">Drawn from {mixed.deckCount} decks</span>{" "}
                <DeckRecord artifact={artifact} deck={MIXED_DECK} />
              </a>
            </li>
          </ul>
        </section>
      )}
      {groups.map(({ tag, decks: grouped }) => (
        <section className="deck-group" key={tag} aria-labelledby={`deck-group-${tag}`}>
          <h2 id={`deck-group-${tag}`} className="deck-group-title">{tag}<span className="deck-group-note">{DECK_GROUP_NOTES[tag]}</span></h2>
          <ul className="deck-list">
            {grouped.map((deck) => (
              <li key={deck.id}>
                <a className="deck-card" href={`/?deck=${deck.id}${query}`}>
                  <span className="deck-title">{deck.title}</span>{" "}
                  <span className="deck-description">{deck.description}</span>{" "}
                  <span className="deck-size">{deck.poolSize} rounds in the deck</span>{" "}
                  <DeckRecord artifact={artifact} deck={deck.id} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ClearRecords artifact={artifact} />
    </main>
  );
}

/** What each group of decks asks of a player. */
const DECK_GROUP_NOTES: Readonly<Record<"Recognise" | "Reason", string>> = Object.freeze({
  Recognise: "Tell where code comes from.",
  Reason: "Work out what code does.",
});

/** A lab tester's picks, kept on links that deal a new game; empty outside lab mode. */
const labQuery = (overrides: Partial<Arms>): string =>
  Object.entries(overrides).map(([factor, level]) => `&${factor}=${level}`).join("");

const THEME_LABELS: Readonly<Record<Level<"theme">, string>> = Object.freeze({
  terminal: "Terminal", paper: "Paper", arcade: "Arcade", contrast: "High contrast",
});

/**
 * Lab mode's bar: switchers for the design (#114), with generative UI on, and the theme (#125). Players outside lab
 * mode never see it; their game's arms are the draw's.
 */
function LabBar({ deck, deal, arms, overrides, genuiEnabled }: {
  readonly deck: GameSource;
  readonly deal: DealSeries | DailyDeal;
  readonly arms: Arms;
  readonly overrides: Partial<Arms>;
  readonly genuiEnabled: boolean;
}) {
  const href = (change: Partial<Arms>) => `${gameHref(deck.id, deal)}${labQuery({ ...overrides, ...change })}`;
  const design: Design | null = arms.design === "off" ? null : arms.design;
  return (
    <div className="lab-bar">
      {genuiEnabled && (
        <nav className="design-nav" aria-label="Designs">
          <span className="design-nav-label">Design:</span>
          {READY_DESIGNS.map((name) => (
            <a key={name} href={href({ design: name })} aria-current={name === design ? "page" : undefined}>{DESIGN_LABELS[name]}</a>
          ))}
          <a href={href({ design: "off" })} aria-current={design === null ? "page" : undefined}>Static</a>
        </nav>
      )}
      <nav className="design-nav" aria-label="Themes">
        <span className="design-nav-label">Theme:</span>
        {FACTORS.theme.map((name) => (
          <a key={name} href={href({ theme: name })} aria-current={name === arms.theme ? "page" : undefined}>{THEME_LABELS[name]}</a>
        ))}
      </nav>
    </div>
  );
}

/** What a player past the deal limit (#98) sees in place of a game: nothing is dealt or recorded, and they may try again. */
function DealLimited({ href }: { readonly href: string }) {
  return (
    <main className="empty-state" aria-labelledby="deal-limited-title">
      <h1 id="deal-limited-title">Too many new games — wait a minute</h1>
      <p>Each player can start only so many games a minute. <a href={href}>Try again</a> once it has passed.</p>
    </main>
  );
}

/**
 * Today's five on a date this server won't deal (#172): a day already over everywhere, or one not yet begun anywhere.
 * Nothing is dealt or recorded.
 */
function DailyClosed({ query }: { readonly query: string }) {
  return (
    <main className="empty-state" aria-labelledby="daily-closed-title">
      <h1 id="daily-closed-title">That day’s five isn’t open</h1>
      <p>Today’s five deals only on today’s date, wherever you are. <a href={`/?deck=${DAILY_DECK}${query}`}>Play today’s five</a>{" "}
        or <a href="/">choose another deck</a>.</p>
    </main>
  );
}

/** A game's address: a seeded deal's game carries its seed and number (#40), and today's five its date (#172). */
const gameHref = (deck: SessionDeckId, deal: DealSeries | DailyDeal): string =>
  "date" in deal ? `/?deck=${deck}&date=${deal.date}` : `/?deck=${deck}&deal=${deal.seed}&game=${deal.game}`;

/** The deal and game a page's address names, when both are well formed. */
const seriesOf = (query: Readonly<Record<string, string | string[] | undefined>>): DealSeries | undefined => {
  const game = typeof query.game === "string" && /^\d{1,3}$/u.test(query.game) ? Number(query.game) : Number.NaN;
  return typeof query.deal === "string" && DEAL_SEED.test(query.deal) && game <= MAXIMUM_GAME ? { seed: query.deal, game } : undefined;
};

/**
 * A five-round game from the deck's pool: a seeded deal's game, or today's five on the player's date. The server holds
 * its progress, the arms it drew (#106), and whether it records events (#107); a browser that sends `Sec-GPC: 1` gets a
 * game that records none.
 */
function DealtSession({ deck, deal, arms, record, replayed, overrides, origin }: {
  readonly deck: GameSource; readonly deal: DealSeries | DailyDeal; readonly arms: Arms; readonly record: boolean;
  readonly replayed: boolean; readonly overrides: Partial<Arms>; readonly origin: string | null;
}) {
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return null;
  // Today's five deals from its date, so a reload or a new game that day deals the same five (#74). The game seals its
  // date, as a seeded deal's game seals its seed, so it can become a challenge (#173).
  const { mode, sessionToken, wrapped } = loaded.experiment.dealGame(deck.id, Math.random, Date.now(), { arms, record }, deal);
  // The next game of a seeded deal shares no round with this one until the pool is spent. Today's five moves to a mix,
  // and can be played again, recording nothing (#172).
  const next = "seed" in deal ? gameHref(deck.id, { ...deal, game: Math.min(deal.game + 1, MAXIMUM_GAME) }) : `/?deck=${MIXED_DECK}`;
  const replay = "date" in deal ? { replayHref: `${gameHref(deck.id, deal)}&replay=1${labQuery(overrides)}` } : {};
  // A mixed game names each round's deck; a deck's own game needs no reminder.
  const roundDecks = deck.id === MIXED_DECK || deck.id === DAILY_DECK
    ? Object.fromEntries(loaded.experiment.decks.map(({ id, title }) => [id, title])) : undefined;
  // A shared link deals a friend this very game (#171), so it carries the deal or the date, and never a replay or a
  // tester's lab picks.
  const share = origin === null ? {} : { shareHref: `${origin}${gameHref(deck.id, deal)}` };
  // A finished game can also challenge a friend (#173), with a link of its own.
  const challenge = origin === null ? {} : { duel: { role: "challenger", origin, createChallenge: createDuelChallenge } as const };
  // A finished game joins the player's records in their browser (#63), under this round set; a replay of today's five
  // doesn't, since its player has seen its answers.
  const records = replayed ? {} : { records: { artifact: recordsArtifact(loaded.experiment.artifactHash), deck: deck.id, date: "date" in deal ? deal.date : null } };
  return (
    <>
      {wrapped && <p className="deal-note">You’ve now seen every round in this deck, so this game starts it over.</p>}
      <DemoArcade key={sessionToken} mode={mode} sessionToken={sessionToken} deckTitle={deck.title} {...(roundDecks ? { roundDecks } : {})}
        authorizeRevealAction={authorizeLocalExperimentReveal} revealHintAction={revealLocalExperimentHint}
        chooseAnotherDeckHref="/" newGameHref={`${next}${labQuery(overrides)}`} {...replay} {...share} {...challenge} {...records}
        {...(arms.design === "off" ? {} : { genuiDesign: arms.design })} />
    </>
  );
}

export default async function Page({ searchParams }: PageProps) {
  const loaded = activeLocalRealExperiment();
  const query = await searchParams;
  const requested = query.deck;
  const genuiEnabled = process.env.GENUI_ENABLED === "1";
  // The experiment's draw decides each game's arms; only lab mode lets a tester pick them by query.
  const lab = labMode();
  const overrides = lab ? labOverrides(query) : {};
  const arms = assignArms({ genuiEnabled, disabled: parseDisabled(process.env.EXPERIMENT_DISABLED), overrides });
  const requestHeaders = await headers();
  const record = requestHeaders.get("sec-gpc") !== "1";
  // A duel's link (#173) shows its own page: a challenge's intro, the friend's game of it, or a result.
  const duel = duelRequest(query);
  if (loaded.ok && duel !== null) {
    // Playing a challenge deals a game, so it spends a deal; opening an intro or a result spends a duel open (#98).
    const rateLimited = limited(duel.kind === "play" ? "deal" : "duel_open", clientKey(requestHeaders));
    return <DuelPage request={duel} experiment={loaded.experiment} record={record} origin={publicOrigin(requestHeaders)} labTheme={overrides.theme}
      rateLimited={rateLimited} />;
  }
  const source = requestedSource(requested);
  // Today's five is dealt on the player's own date (#172), which only their browser knows: an address without one has
  // the browser add it, and one with a date this server won't deal is refused; neither deals, spends, or records a game.
  const date = source?.id === DAILY_DECK ? dailyDateOf(query, Date.now()) : null;
  if (source?.id === DAILY_DECK && date === null) {
    return (
      <PageFrame theme={overrides.theme ?? CONTROL.theme}>
        {query.date === undefined ? <DailyRedirect query={labQuery(overrides)} /> : (
          <>
            <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
            <DailyClosed query={labQuery(overrides)} />
          </>
        )}
      </PageFrame>
    );
  }
  const deal = date === null ? seriesOf(query) : { date };
  // Today's five names its date, so its share line carries it.
  const deck = source && date !== null ? { ...source, title: `${source.title}, ${date}` } : source;
  // Today's five played again once it's done (`&replay=1`, #172) records nothing: its player has seen its answers.
  const replayed = date !== null && query.replay === "1";
  // A deck's game spends the player's deal allowance (#98); the redirect to a fresh deal's first game spends nothing, so
  // a game from the chooser costs one deal, as "Deal new rounds" does. Past it the page says so, before any deal or event.
  const dealLimited = deck !== undefined && deal !== undefined && limited("deal", clientKey(requestHeaders));
  // A deck's game is a game of a seeded deal (#40): an address without one starts a fresh deal at its first game, so a
  // reload shows the same game and "Deal new rounds" the next. Today's five is seeded by its date instead.
  if (deck && deal === undefined) {
    redirect(`${gameHref(deck.id, { seed: randomBytes(4).toString("hex"), game: 0 })}${labQuery(overrides)}`);
  }
  // A game shows the theme it drew (#125); the chooser, outside any game, keeps the original unless a tester picks one.
  const theme = deck && !dealLimited ? arms.theme : overrides.theme ?? CONTROL.theme;
  return (
    <PageFrame theme={theme}>
      {!loaded.ok
        ? <ArtifactUnavailable reason={loaded.reason} />
        : deck && deal
          ? (
            <>
              <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
              {dealLimited
                ? <DealLimited href={`${gameHref(deck.id, deal)}${replayed ? "&replay=1" : ""}${labQuery(overrides)}`} />
                : (
                  <>
                    {lab && <LabBar deck={deck} deal={deal} arms={arms} overrides={overrides} genuiEnabled={genuiEnabled} />}
                    <DealtSession deck={deck} deal={deal} arms={arms} record={record && !replayed} replayed={replayed} overrides={overrides}
                      origin={publicOrigin(requestHeaders)} />
                  </>
                )}
            </>
          )
          : <DeckChooser decks={loaded.experiment.decks} mixed={loaded.experiment.mixed} query={labQuery(overrides)}
            artifact={recordsArtifact(loaded.experiment.artifactHash)} />}
    </PageFrame>
  );
}
