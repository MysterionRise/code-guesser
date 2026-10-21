import { randomBytes } from "node:crypto";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeLocalExperimentReveal, revealLocalExperimentHint } from "./actions";
import { ArtifactUnavailable } from "../demo/artifact-unavailable";
import { DemoArcade } from "../demo/demo-arcade";
import { DAILY_DESCRIPTION, DAILY_TITLE, gameSources, type GameSource } from "../demo/game-sources.server";
import {
  LOCAL_REAL_EXPERIMENT_NOTICE_BODY,
  LOCAL_REAL_EXPERIMENT_NOTICE_LEAD,
  activeLocalRealExperiment,
} from "../demo/local-real-experiment-loader.server";
import { DEAL_SEED, MAXIMUM_GAME, localDate, type DealSeries } from "../demo/local-real-experiment-deal.server";
import type { LocalRealDeck, LocalRealMix } from "../demo/local-real-experiment.server";
import { DAILY_DECK, MIXED_DECK, type SessionDeckId } from "../demo/local-real-experiment-domain.server";
import { CONTROL, FACTORS, assignArms, labMode, labOverrides, parseDisabled, type Arms, type Level } from "../experiment/arms";
import { DESIGN_LABELS, READY_DESIGNS, type Design } from "../genui/designs";
import { publicOrigin } from "../server/public-origin.server";

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
 * chooser keeps the layout's. The preview is an image of the deck's title (`app/og/[deck]/route.tsx`).
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const source = requestedSource((await searchParams).deck);
  const origin = publicOrigin(await headers());
  const base: Metadata = origin === null ? {} : { metadataBase: new URL(origin) };
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
 * mode `query` carries the tester's picks onto each link.
 */
function DeckChooser({ decks, mixed, query }: { readonly decks: readonly LocalRealDeck[]; readonly mixed: LocalRealMix | null; readonly query: string }) {
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
            <li>
              <a className="deck-card" href={`/?deck=${DAILY_DECK}${query}`}>
                <span className="deck-title">{DAILY_TITLE}</span>{" "}
                <span className="deck-description">{DAILY_DESCRIPTION}</span>{" "}
                <span className="deck-size">{localDate(new Date())}</span>
              </a>
            </li>
            <li>
              <a className="deck-card" href={`/?deck=${MIXED_DECK}${query}`}>
                <span className="deck-title">{mixed.title}</span>{" "}
                <span className="deck-description">{mixed.description}</span>{" "}
                <span className="deck-size">Drawn from {mixed.deckCount} decks</span>
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
                  <span className="deck-size">{deck.poolSize} rounds in the deck</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
function LabBar({ deck, series, arms, overrides, genuiEnabled }: {
  readonly deck: GameSource;
  readonly series: DealSeries | undefined;
  readonly arms: Arms;
  readonly overrides: Partial<Arms>;
  readonly genuiEnabled: boolean;
}) {
  const href = (change: Partial<Arms>) => `${gameHref(deck.id, series)}${labQuery({ ...overrides, ...change })}`;
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

/**
 * A fresh five-round game from the deck's pool, dealt on every visit. The server holds its progress, the arms it
 * drew (#106), and whether it records events (#107); a browser that sends `Sec-GPC: 1` gets a game that records none.
 */
/** A game's address: a seeded deal's game carries its seed and number (#40); today's five needs neither. */
const gameHref = (deck: SessionDeckId, series: DealSeries | undefined): string =>
  series ? `/?deck=${deck}&deal=${series.seed}&game=${series.game}` : `/?deck=${deck}`;

/** The deal and game a page's address names, when both are well formed. */
const seriesOf = (query: Readonly<Record<string, string | string[] | undefined>>): DealSeries | undefined => {
  const game = typeof query.game === "string" && /^\d{1,3}$/u.test(query.game) ? Number(query.game) : Number.NaN;
  return typeof query.deal === "string" && DEAL_SEED.test(query.deal) && game <= MAXIMUM_GAME ? { seed: query.deal, game } : undefined;
};

function DealtSession({ deck, series, arms, record, overrides, origin }: {
  readonly deck: GameSource; readonly series: DealSeries | undefined; readonly arms: Arms; readonly record: boolean; readonly overrides: Partial<Arms>;
  readonly origin: string | null;
}) {
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return null;
  // Today's five deals from the local date, so a reload or a new game that day deals the same five (#74). The game
  // seals its date, as a seeded deal's game seals its seed, so it can become a challenge (#173).
  const now = Date.now();
  const deal = deck.id === DAILY_DECK ? { date: localDate(new Date(now)) } : series;
  const { mode, sessionToken, wrapped } = loaded.experiment.dealGame(deck.id, Math.random, now, { arms, record }, deal);
  // The next game of a seeded deal shares no round with this one until the pool is spent; today's five moves to a mix.
  const next = series ? gameHref(deck.id, { ...series, game: Math.min(series.game + 1, MAXIMUM_GAME) }) : `/?deck=${MIXED_DECK}`;
  // A mixed game names each round's deck; a deck's own game needs no reminder.
  const roundDecks = deck.id === MIXED_DECK || deck.id === DAILY_DECK
    ? Object.fromEntries(loaded.experiment.decks.map(({ id, title }) => [id, title])) : undefined;
  // A shared link deals a friend this very game (#171), so it carries the deal and never a tester's lab picks. Today's
  // five links to its plain address until that carries the date (#172).
  const share = origin === null ? {} : { shareHref: `${origin}${gameHref(deck.id, series)}` };
  return (
    <>
      {wrapped && <p className="deal-note">You’ve now seen every round in this deck, so this game starts it over.</p>}
      <DemoArcade key={sessionToken} mode={mode} sessionToken={sessionToken} deckTitle={deck.title} {...(roundDecks ? { roundDecks } : {})}
        authorizeRevealAction={authorizeLocalExperimentReveal} revealHintAction={revealLocalExperimentHint}
        chooseAnotherDeckHref="/" newGameHref={`${next}${labQuery(overrides)}`} {...share}
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
  const series = seriesOf(query);
  const source = requestedSource(requested);
  // Today's five names its date, so its share line carries it.
  const deck = source?.id === DAILY_DECK ? { ...source, title: `${source.title}, ${localDate(new Date())}` } : source;
  // A deck's game is a game of a seeded deal (#40): an address without one starts a fresh deal at its first game, so a
  // reload shows the same game and "Deal new rounds" the next. Today's five is seeded by its date instead.
  if (deck && deck.id !== DAILY_DECK && series === undefined) {
    redirect(`${gameHref(deck.id, { seed: randomBytes(4).toString("hex"), game: 0 })}${labQuery(overrides)}`);
  }
  // A game shows the theme it drew (#125); the chooser, outside any game, keeps the original unless a tester picks one.
  const theme = deck ? arms.theme : overrides.theme ?? CONTROL.theme;
  return (
    <div className="demo-page" data-theme={theme}>
      <p className="demo-notice">
        <strong>{LOCAL_REAL_EXPERIMENT_NOTICE_LEAD}</strong> {LOCAL_REAL_EXPERIMENT_NOTICE_BODY}
      </p>
      <noscript><p className="demo-notice">CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.</p></noscript>
      {!loaded.ok
        ? <ArtifactUnavailable reason={loaded.reason} />
        : deck
          ? (
            <>
              <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
              {lab && <LabBar deck={deck} series={series} arms={arms} overrides={overrides} genuiEnabled={genuiEnabled} />}
              <DealtSession deck={deck} series={deck.id === DAILY_DECK ? undefined : series} arms={arms} record={record} overrides={overrides}
                origin={publicOrigin(requestHeaders)} />
            </>
          )
          : <DeckChooser decks={loaded.experiment.decks} mixed={loaded.experiment.mixed} query={labQuery(overrides)} />}
    </div>
  );
}
