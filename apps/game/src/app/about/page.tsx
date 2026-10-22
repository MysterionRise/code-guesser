import type { Metadata } from "next";

import { gameSources } from "../../demo/game-sources.server";
import { activeLocalRealExperiment } from "../../demo/local-real-experiment-loader.server";
import { PageFrame } from "../../demo/page-frame";
import { CONTROL, labMode, labOverrides } from "../../experiment/arms";

const DESCRIPTION = "How to play CodeGuessr: the decks, scoring, keys, duels, and the experiment each game is part of.";

export const metadata: Metadata = { title: "About", description: DESCRIPTION };

/**
 * The privacy page this one links to. It is #99's (L8), which isn't built yet: set this to "/privacy" when it is, and
 * the experiment section links it.
 */
const PRIVACY_HREF: string | null = null;

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

/**
 * How to play, the keys, the decks, duels, and the experiment and what it records (#168). The decks are this artifact's
 * own titles and descriptions, read through the list a game is dealt from, never a round. Like the chooser, the page
 * keeps the original theme unless a lab tester picks one.
 */
export default async function AboutPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const loaded = activeLocalRealExperiment();
  const sources = loaded.ok ? gameSources(loaded.experiment) : [];
  const theme = (labMode() ? labOverrides(query).theme : undefined) ?? CONTROL.theme;
  return (
    <PageFrame theme={theme}>
      <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
      <main className="about-page" aria-labelledby="about-title">
        <h1 id="about-title">About CodeGuessr</h1>
        <p className="about-intro">
          Read real open-source code and make your call: which project or language it is, what it returns, which line a
          fix changed, and more.
        </p>

        <h2 id="about-play">How to play</h2>
        <ol>
          <li>Pick a deck. Each game deals five rounds from its pool.</li>
          <li>Read the code, and take up to two hints if you need them.</li>
          <li>Pick an option and lock it in. The reveal shows the answer, why it is right, and where the code comes from.</li>
        </ol>
        <p>
          A round is worth 250 points for each option it offers: 1,000 with four options and 500 with two, so a random
          guess earns 250 a round on every deck. Hints cost points: a right answer earns 100% with no hint, 80% after
          one, and 50% after two. A wrong answer earns nothing.
        </p>
        <p>
          A game’s address holds its deal, so a reload shows the same five rounds, and “Deal new rounds” deals the next
          five, with none you have seen until the deck runs out.
        </p>

        <h2 id="about-keys">Keys</h2>
        <ul>
          <li><kbd>1</kbd>–<kbd>4</kbd> pick an option.</li>
          <li><kbd>Enter</kbd> locks it in.</li>
          <li><kbd>H</kbd> buys the next hint.</li>
          <li><kbd>N</kbd> moves to the next round.</li>
        </ul>
        <p className="about-note">The keys wait while a modifier key is held, and never fire from a text field or the code.</p>

        <h2 id="about-decks">The decks</h2>
        {sources.length > 0
          ? (
            <dl className="about-decks">
              {sources.map(({ id, title, description }) => (
                <div key={id}>
                  <dt><a href={`/?deck=${id}`}>{title}</a></dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          )
          : <p>No decks are ready yet.</p>}

        <h2 id="about-duels">Duels</h2>
        <p>
          Finish a game and “Challenge a friend” makes a link to it. Your friend plays the same five rounds, then sees
          both games side by side and can send you a result link back. A challenge lasts seven days and a result
          thirty. The names you type stay after the link’s <code>#</code>, which a browser never sends to the server.
        </p>

        <h2 id="about-sources">Where the code comes from</h2>
        <p>
          Every round is public code under an open licence, from The Stack v2, GitHub, TheAlgorithms, Defects4J,
          BugsInPy, TodoMVC, and Exercism. The rounds are chosen and checked automatically before play, not reviewed by
          hand, and every game deals from the same frozen set. Each reveal names the code’s author, repository, and
          licence, and links the file.
        </p>

        <h2 id="about-experiment">The experiment</h2>
        <p>CodeGuessr is also an experiment in how to show and explain code. Each game draws at random, independently:</p>
        <ul>
          <li>a look: Terminal, Paper, Arcade, or High contrast;</li>
          <li>
            an explainer for after you answer: the plain reveal, notes from a catalog, a composed panel, a visualizer, or
            a host to chat with;
          </li>
          <li>on some decks, a question layer: a short guide above the code, with hints of its own.</li>
        </ul>
        <p>
          A model writes the explainers, and it never sees the round’s code or its answer before you lock in yours.
          Its notes can be wrong.
        </p>
        <p>
          To compare them, the game records anonymous events about each game: the deck and what it drew, the hints
          taken, whether each round was right, the points and time taken, the screen as a phone, tablet, or desktop,
          and whether you dealt again, shared, or used the explainer. An event names its game by a random id and its
          day, never the time. Nothing records an account, IP address, user agent, cookie, or any id that follows you
          from game to game, nor chat text, the round’s code, or the option you chose. A browser that sends Global
          Privacy Control (<code>Sec-GPC: 1</code>) gets games that record nothing.
        </p>
        {PRIVACY_HREF !== null && <p><a href={PRIVACY_HREF}>Privacy</a></p>}
      </main>
    </PageFrame>
  );
}
