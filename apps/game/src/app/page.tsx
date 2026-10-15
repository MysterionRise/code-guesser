import { authorizeLocalExperimentReveal, revealLocalExperimentHint } from "./actions";
import { ArtifactUnavailable } from "../demo/artifact-unavailable";
import { DemoArcade } from "../demo/demo-arcade";
import {
  LOCAL_REAL_EXPERIMENT_NOTICE_BODY,
  LOCAL_REAL_EXPERIMENT_NOTICE_LEAD,
  activeLocalRealExperiment,
} from "../demo/local-real-experiment-loader.server";
import type { LocalRealDeck } from "../demo/local-real-experiment.server";
import { DESIGN_LABELS, READY_DESIGNS, readyDesign, type Design } from "../genui/designs";

const DECK_COUNT_WORDS = ["No decks", "One deck", "Two decks", "Three decks", "Four decks", "Five decks", "Six decks"] as const;
/** A run publishes every deck it could fill, so the chooser counts what this artifact holds. */
const deckSummary = (count: number): string => `${DECK_COUNT_WORDS[count] ?? `${count} decks`} to choose from.`;

/** What a deck asks of a player: to recognise where code comes from, or to reason about what it does. */
const DECK_TAGS: Readonly<Record<string, string>> = Object.freeze({
  project: "Recognise", language: "Recognise", algorithm: "Recognise", "before-after": "Reason", output: "Reason", fix: "Reason",
});

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

function DeckChooser({ decks }: { readonly decks: readonly LocalRealDeck[] }) {
  return (
    <main className="deck-chooser" aria-labelledby="deck-chooser-title">
      <h1 id="deck-chooser-title">Pick a deck</h1>
      <p className="deck-intro">
        {deckSummary(decks.length)} Each game deals five real rounds from the deck. Read the code, take up to two hints,
        and lock in your guess.
      </p>
      <ul className="deck-list">
        {decks.map((deck) => (
          <li key={deck.id}>
            <a className="deck-card" href={`/?deck=${deck.id}`}>
              <span className="deck-title">{deck.title}</span>{" "}
              {DECK_TAGS[deck.id] && <span className="deck-tag">{DECK_TAGS[deck.id]}</span>}{" "}
              <span className="deck-description">{deck.description}</span>{" "}
              <span className="deck-size">{deck.poolSize} rounds in the deck</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** The `design` query, kept on links that deal a new game. */
const designQuery = (design: Design | null): string => design === null ? "&design=off" : `&design=${design}`;

/** Local design switcher (#114): every ready generative design, and the static game. */
function DesignNav({ deck, design }: { readonly deck: LocalRealDeck; readonly design: Design | null }) {
  return (
    <nav className="design-nav" aria-label="Designs">
      <span className="design-nav-label">Design:</span>
      {READY_DESIGNS.map((name) => (
        <a key={name} href={`/?deck=${deck.id}${designQuery(name)}`} aria-current={name === design ? "page" : undefined}>{DESIGN_LABELS[name]}</a>
      ))}
      <a href={`/?deck=${deck.id}${designQuery(null)}`} aria-current={design === null ? "page" : undefined}>Static</a>
    </nav>
  );
}

/** A fresh five-round game from the deck's pool, dealt on every visit; the server holds its progress. */
function DealtSession({ deck, design, keepDesign }: { readonly deck: LocalRealDeck; readonly design: Design | null; readonly keepDesign: boolean }) {
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return null;
  const { mode, sessionToken } = loaded.experiment.dealGame(deck.id);
  return (
    <DemoArcade key={sessionToken} mode={mode} sessionToken={sessionToken} deckTitle={deck.title}
      authorizeRevealAction={authorizeLocalExperimentReveal} revealHintAction={revealLocalExperimentHint}
      chooseAnotherDeckHref="/" newGameHref={`/?deck=${deck.id}${keepDesign ? designQuery(design) : ""}`}
      {...(design === null ? {} : { genuiDesign: design })} />
  );
}

export default async function Page({ searchParams }: PageProps) {
  const loaded = activeLocalRealExperiment();
  const query = await searchParams;
  const requested = query.deck;
  // Generative UI is the server's choice: off unless enabled, then the requested ready design or the catalog.
  const genuiEnabled = process.env.GENUI_ENABLED === "1";
  const design: Design | null = !genuiEnabled || query.design === "off" ? null : readyDesign(query.design) ?? "catalog";
  const deck = loaded.ok && typeof requested === "string"
    ? loaded.experiment.decks.find(({ id }) => id === requested)
    : undefined;
  return (
    <div className="demo-page">
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
              {genuiEnabled && <DesignNav deck={deck} design={design} />}
              <DealtSession deck={deck} design={design} keepDesign={typeof query.design === "string"} />
            </>
          )
          : <DeckChooser decks={loaded.experiment.decks} />}
    </div>
  );
}
