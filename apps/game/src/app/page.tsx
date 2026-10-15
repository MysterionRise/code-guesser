import { headers } from "next/headers";

import { authorizeLocalExperimentReveal, revealLocalExperimentHint } from "./actions";
import { ArtifactUnavailable } from "../demo/artifact-unavailable";
import { DemoArcade } from "../demo/demo-arcade";
import {
  LOCAL_REAL_EXPERIMENT_NOTICE_BODY,
  LOCAL_REAL_EXPERIMENT_NOTICE_LEAD,
  activeLocalRealExperiment,
} from "../demo/local-real-experiment-loader.server";
import type { LocalRealDeck } from "../demo/local-real-experiment.server";
import { assignArms, labMode, labOverrides, parseDisabled, type Arms } from "../experiment/arms";
import { DESIGN_LABELS, READY_DESIGNS, type Design } from "../genui/designs";

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

/** A lab tester's picks, kept on links that deal a new game; empty outside lab mode. */
const labQuery = (overrides: Partial<Arms>): string =>
  Object.entries(overrides).map(([factor, level]) => `&${factor}=${level}`).join("");

/** Lab mode's design switcher (#114): every ready generative design, and the static game. */
function DesignNav({ deck, design, overrides }: { readonly deck: LocalRealDeck; readonly design: Design | null; readonly overrides: Partial<Arms> }) {
  const href = (level: Design | "off") => `/?deck=${deck.id}${labQuery({ ...overrides, design: level })}`;
  return (
    <nav className="design-nav" aria-label="Designs">
      <span className="design-nav-label">Design:</span>
      {READY_DESIGNS.map((name) => (
        <a key={name} href={href(name)} aria-current={name === design ? "page" : undefined}>{DESIGN_LABELS[name]}</a>
      ))}
      <a href={href("off")} aria-current={design === null ? "page" : undefined}>Static</a>
    </nav>
  );
}

/**
 * A fresh five-round game from the deck's pool, dealt on every visit. The server holds its progress, the arms it
 * drew (#106), and whether it records events (#107); a browser that sends `Sec-GPC: 1` gets a game that records none.
 */
function DealtSession({ deck, arms, record, overrides }: { readonly deck: LocalRealDeck; readonly arms: Arms; readonly record: boolean; readonly overrides: Partial<Arms> }) {
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return null;
  const { mode, sessionToken } = loaded.experiment.dealGame(deck.id, Math.random, Date.now(), { arms, record });
  return (
    <DemoArcade key={sessionToken} mode={mode} sessionToken={sessionToken} deckTitle={deck.title}
      authorizeRevealAction={authorizeLocalExperimentReveal} revealHintAction={revealLocalExperimentHint}
      chooseAnotherDeckHref="/" newGameHref={`/?deck=${deck.id}${labQuery(overrides)}`}
      {...(arms.design === "off" ? {} : { genuiDesign: arms.design })} />
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
  const record = (await headers()).get("sec-gpc") !== "1";
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
              {lab && genuiEnabled && <DesignNav deck={deck} design={arms.design === "off" ? null : arms.design} overrides={overrides} />}
              <DealtSession deck={deck} arms={arms} record={record} overrides={overrides} />
            </>
          )
          : <DeckChooser decks={loaded.experiment.decks} />}
    </div>
  );
}
