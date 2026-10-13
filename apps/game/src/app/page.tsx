import { authorizeLocalExperimentReveal } from "./actions";
import { DemoArcade } from "../demo/demo-arcade";
import {
  LOCAL_REAL_EXPERIMENT_NOTICE,
  activeLocalRealExperiment,
} from "../demo/local-real-experiment-loader.server";
import type { LocalRealDeck } from "../demo/local-real-experiment.server";

const DECK_COUNT_WORDS = ["No decks", "One deck", "Two decks", "Three decks"] as const;
/** A run publishes every deck it could fill, so the notice counts what this artifact holds. */
const deckSummary = (count: number): string => `${DECK_COUNT_WORDS[count] ?? `${count} decks`} of five rounds.`;

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

function DeckChooser({ decks }: { readonly decks: readonly LocalRealDeck[] }) {
  return (
    <main className="deck-chooser" aria-labelledby="deck-chooser-title">
      <h1 id="deck-chooser-title">Pick a deck</h1>
      <p className="deck-intro">Each deck is five real rounds. Read the code, take up to two hints, and lock in your guess.</p>
      <ul className="deck-list">
        {decks.map((deck) => (
          <li key={deck.id}>
            <a className="deck-card" href={`/?deck=${deck.id}`}>
              <span className="deck-title">{deck.title}</span>{" "}
              <span className="deck-description">{deck.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default async function Page({ searchParams }: PageProps) {
  const loaded = activeLocalRealExperiment();
  const requested = (await searchParams).deck;
  const deck = loaded.ok && typeof requested === "string"
    ? loaded.experiment.decks.find(({ id }) => id === requested)
    : undefined;
  return (
    <div className="demo-page">
      <p className="demo-notice">
        <strong>{LOCAL_REAL_EXPERIMENT_NOTICE}</strong> {loaded.ok ? deckSummary(loaded.experiment.decks.length) : "No rounds are available."}
      </p>
      {deck?.notice && <p className="demo-notice deck-notice">{deck.notice}</p>}
      <noscript><p className="demo-notice">CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.</p></noscript>
      {!loaded.ok
        ? (
          <section className="empty-state" role="alert" aria-labelledby="empty-state-title">
            <h1 id="empty-state-title">No rounds are ready yet</h1>
            <p>The decks are prepared from real open-source code before play, and this copy has none to serve.</p>
            <p className="operator-note">
              For the operator: run <code>pnpm prepare:poc</code>, verify the new artifact, and pin its hash. The
              current artifact is missing, from an older format, or does not match its pinned hash.
            </p>
          </section>
        )
        : deck
          ? (
            <>
              <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
              <DemoArcade key={deck.id} mode={deck.mode} deckTitle={deck.title} authorizeRevealAction={authorizeLocalExperimentReveal} chooseAnotherDeckHref="/" />
            </>
          )
          : <DeckChooser decks={loaded.experiment.decks} />}
    </div>
  );
}
