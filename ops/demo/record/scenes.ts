import type { GifOptions } from "./encode";
import type { CaptionStyle } from "./overlay";

/** One scripted interaction with the running game. */
export type Step =
  | Readonly<{ kind: "goto"; path: string }>
  // Checks the current round's right answer. The recorder reads it from the artifact on the Node side, as the
  // browser tests do; the page itself never learns it.
  | Readonly<{ kind: "answer" }>
  // Checks a wrong answer to the current round: the first option the artifact lists that isn't right.
  | Readonly<{ kind: "miss" }>
  // Opens the scene's challenge link (`Scene.challenge`), as the friend.
  | Readonly<{ kind: "openChallenge" }>
  | Readonly<{ kind: "caption"; text: string }>
  | Readonly<{ kind: "click"; name: string }>
  | Readonly<{ kind: "link"; name: string }>
  | Readonly<{ kind: "choose"; index: number }>
  | Readonly<{ kind: "expectText"; pattern: string }>
  | Readonly<{ kind: "expectHeading"; pattern: string }>
  | Readonly<{ kind: "scrollTo"; selector: string }>
  // Jumps without animation, for a hard cut: `start` puts the element at the top, `center` in the middle.
  | Readonly<{ kind: "jumpTo"; selector: string; block: "start" | "center" }>
  | Readonly<{ kind: "wait"; milliseconds: number }>;

export interface Scene {
  /** Output basename under docs/media. */
  readonly id: string;
  readonly gif: Partial<GifOptions>;
  /** When set, the same screencast is also encoded to this MP4 basename. */
  readonly mp4?: string;
  /** The page size in CSS pixels; a phone viewport (390x844) unless set. */
  readonly viewport?: Readonly<{ width: number; height: number }>;
  readonly captionStyle?: CaptionStyle;
  /** The page's motion preference; the game animates unless it is `reduce`. */
  readonly reducedMotion?: "reduce" | "no-preference";
  /**
   * A duel's challenger (#173), played off camera before the recording starts, in a browser of their own: `steps`
   * play a game, which becomes a challenge under `name`. An `openChallenge` step opens its link.
   */
  readonly challenge?: Readonly<{ name: string; steps: readonly Step[] }>;
  readonly steps: readonly Step[];
}

const caption = (text: string): Step => ({ kind: "caption", text });
const click = (name: string): Step => ({ kind: "click", name });
const link = (name: string): Step => ({ kind: "link", name });
const goto = (path: string): Step => ({ kind: "goto", path });
const choose = (index: number): Step => ({ kind: "choose", index });
const wait = (milliseconds: number): Step => ({ kind: "wait", milliseconds });
const verdict: Step = { kind: "expectHeading", pattern: "^(?:Nice read\\.|Not this time\\.)$" };
const answer: Step = { kind: "answer" };
const roundOf = (round: number): Step => ({ kind: "expectText", pattern: `Round ${round} of 5` });

const jumpTo = (selector: string, block: "start" | "center" = "center"): Step => ({ kind: "jumpTo", selector, block });

export const DECKS = Object.freeze([
  "project", "language", "algorithm", "framework", "exercise", "before-after", "output", "fix", "missing-line", "name-function",
] as const);
export type Deck = (typeof DECKS)[number];
type Theme = "terminal" | "paper" | "arcade" | "contrast";

/**
 * Each deck's recorded deal (#40): a fixed seed's first game, so every recording plays the same rounds. Each seed was
 * picked for a first round of the v7 artifact that reads well at a phone's width; the language and algorithm rounds
 * also carry a question layer.
 */
export const DEAL_SEEDS: Readonly<Record<Deck, string>> = Object.freeze({
  project: "c0de000a", language: "5eed000d", algorithm: "5eed000f", framework: "5eed0018", exercise: "c0de0010",
  "before-after": "c0de000c", output: "5eed001c", fix: "5eed0009", "missing-line": "5eed001f", "name-function": "c0de0014",
});
/**
 * The duel scene's challenge (#173): a game of the language deck in the paper theme, with its Marker hunt layer, on a
 * seed no other scene deals, so the server counts it as the challenger's first try.
 */
export const DUEL_DEAL = Object.freeze({ deck: "language", seed: "d0e1d0e1" } as const);

/**
 * A deck's recorded game: its fixed deal with the static design and the theme and question layer asked for. The picks
 * are lab-mode queries, which `next dev` honours; the recorder checks the theme took.
 */
export const dealtPath = (deck: Deck, look: Readonly<{ theme?: Theme; layer?: "on" | "off" }> = {}): string =>
  `/?deck=${deck}&deal=${DEAL_SEEDS[deck]}&game=0&design=off&theme=${look.theme ?? "terminal"}&layer=${look.layer ?? "off"}`;
/** The chooser, with picks its links carry into the game they deal. */
const CHOOSER = "/?design=off&theme=terminal&layer=off";
/** Today's five's card, by its description; it links to the player's own date once the page hydrates (#172). */
export const DAILY_CARD = "The same mixed five all day";
/** Long lines wrap under their own indentation, for panes whose lines run past a phone's width. */
const wrapLines = click("Wrap lines");

/**
 * One hard cut of the vertical demo: open a deck's recorded game under a title sticker, read the question (and its
 * question layer, where asked) and the code, lock in the right answer (after a hint, or with the chosen line
 * highlighted, where asked), and pop the points.
 */
const demoCut = (deck: Deck, title: string, points: string, extras: Readonly<{
  hint?: boolean; highlight?: boolean; wrap?: boolean; theme?: Theme; layer?: "on" | "off";
}> = {}): Step[] => [
  goto(dealtPath(deck, extras)),
  { kind: "expectText", pattern: "Round 1 of 5" },
  ...(extras.wrap ? [wrapLines] : []),
  caption(title),
  wait(850),
  caption(""),
  jumpTo("#round-title", "start"),
  wait(1500),
  ...(extras.hint ? [jumpTo(".hints"), wait(250), click("Reveal hint 1"), wait(1000)] : []),
  jumpTo("fieldset"),
  wait(350),
  answer,
  wait(400),
  ...(extras.highlight ? [jumpTo(".code-line.highlighted"), wait(950), jumpTo("fieldset"), wait(250)] : []),
  click("Lock in answer"),
  { kind: "expectHeading", pattern: "^Nice read\\.$" },
  jumpTo(".reveal h2"),
  caption(points),
  wait(1150),
];

/**
 * The README's headline clip: a vertical, captioned tour of seven of the ten decks, each round answered right, in
 * three of the four themes and with both kinds of question layer (Trace it, Marker hunt).
 */
export const DEMO_SCENE: Scene = Object.freeze({
  id: "demo",
  viewport: Object.freeze({ width: 360, height: 640 }),
  captionStyle: "sticker" as const,
  // Hard cuts only: the game's arrival animation would spend frames on every page load.
  reducedMotion: "reduce" as const,
  // The headline clip gets a larger budget than the per-deck clips (under 10 MB): native width, smooth pops.
  gif: { width: 360, framesPerSecond: 12, maximumColors: 128, speed: 1.2 },
  steps: Object.freeze<Step[]>([
    goto(CHOOSER),
    { kind: "expectHeading", pattern: "^Pick a deck$" },
    caption("Can you read code like a detective?"),
    wait(1500),
    jumpTo(".deck-list", "start"),
    caption("10 decks. Real open-source code."),
    wait(1400),
    ...demoCut("algorithm", "1/7 · Which algorithm?", "Solved it. +1,000", { layer: "on" }),
    ...demoCut("fix", "2/7 · Spot the bug fix", "With a hint. +800", { hint: true, highlight: true }),
    ...demoCut("language", "3/7 · Which language?", "Nailed it. +1,000", { layer: "on", theme: "paper" }),
    ...demoCut("framework", "4/7 · Which framework?", "Spotted it. +1,000"),
    ...demoCut("output", "5/7 · Predict the output", "Traced it. +1,000", { wrap: true, theme: "arcade" }),
    ...demoCut("name-function", "6/7 · Name the function", "Named it. +1,000", { wrap: true }),
    ...demoCut("exercise", "7/7 · Which exercise?", "Aced it. +1,000", { wrap: true, theme: "contrast" }),
    goto(CHOOSER),
    { kind: "expectHeading", pattern: "^Pick a deck$" },
    jumpTo(".deck-list", "start"),
    caption("Or a mixed five, new every day."),
    wait(1500),
    caption("Your turn. Pick a deck."),
    wait(1900),
  ]),
});

/**
 * How a scene locks in a round: the right answer or a wrong one, which the recorder reads from the artifact, or a radio
 * index.
 */
export type Pick = "right" | "miss" | number;
const pickStep = (pick: Pick): Step => pick === "right" ? answer : pick === "miss" ? { kind: "miss" } : choose(pick);

/**
 * How the full run locks in its five rounds: four right and one miss, so it shows the "Not this time." branch too,
 * whatever rounds today's five deals.
 */
export const DEFAULT_ANSWER_CHOREOGRAPHY: readonly Pick[] = Object.freeze(["right", "right", "miss", "right", "right"]);

/** Parses DEMO_ANSWERS ("0,1,1,0,1"): five radio indexes, one per round of the full run; blank means the default. */
export const parseAnswerChoreography = (value: string | undefined): readonly Pick[] => {
  if (value === undefined || value.trim() === "") return DEFAULT_ANSWER_CHOREOGRAPHY;
  const indexes = value.split(",").map((part) => Number(part.trim()));
  if (indexes.length !== 5 || indexes.some((index) => !Number.isInteger(index) || index < 0 || index > 3)) {
    throw new RangeError("DEMO_ANSWERS must list five radio indexes between 0 and 3");
  }
  return Object.freeze(indexes);
};

const ANSWER_CHOREOGRAPHY = parseAnswerChoreography(process.env.DEMO_ANSWERS);

const playRound = (round: number, hints: number): Step[] => [
  roundOf(round),
  ...Array.from({ length: hints }, (_, index) => [click(`Reveal hint ${index + 1}`), wait(700)]).flat(),
  pickStep(ANSWER_CHOREOGRAPHY[round - 1] ?? "right"),
  wait(600),
  click("Lock in answer"),
  verdict,
  { kind: "scrollTo", selector: ".reveal h2" },
  wait(1400),
];

/**
 * One deck's teaser: open its recorded game, take a hint, and lock in the right answer (or, where asked, a wrong one,
 * for the "Not this time." branch). With a `trace` caption it also buys the second hint, a question layer's
 * step-through, and steps it forward.
 */
const deckScene = (
  deck: Deck,
  captions: Readonly<{ opening: string; hint: string; trace?: string; answer: string }>,
  pick: "right" | "miss",
  gif: Partial<GifOptions> = {},
  look: Readonly<{ wrap?: boolean; layer?: "on" | "off" }> = {},
): Scene => ({
  id: `deck-${deck}`,
  gif,
  steps: [
    goto(dealtPath(deck, look)),
    { kind: "expectText", pattern: "Round 1 of 5" },
    ...(look.wrap ? [wrapLines] : []),
    wait(500),
    caption(captions.opening),
    wait(2200),
    caption(captions.hint),
    wait(500),
    click("Reveal hint 1"),
    wait(1500),
    ...(captions.trace === undefined ? [] : [
      caption(captions.trace),
      click("Reveal hint 2"),
      { kind: "scrollTo", selector: ".trace-stepper" } as const,
      wait(900),
      ...[1, 2, 3].flatMap(() => [click("Next step"), wait(1000)]),
    ]),
    caption(captions.answer),
    { kind: "scrollTo", selector: "fieldset" },
    wait(800),
    pickStep(pick),
    wait(800),
    click("Lock in answer"),
    verdict,
    { kind: "scrollTo", selector: ".reveal h2" },
    wait(2600),
    caption(""),
    wait(300),
  ],
});

/** One round of a duel, as its plan plays it: the hints it buys, then the right answer or a miss. */
type DuelRound = Readonly<{ hints: number; pick: "right" | "miss" }>;
/** The challenger's game: four right, the first after a hint, and one miss (3,800 of 5,000). */
export const CHALLENGER_PLAN: readonly DuelRound[] = Object.freeze([
  { hints: 1, pick: "right" }, { hints: 0, pick: "miss" }, { hints: 0, pick: "right" }, { hints: 0, pick: "right" }, { hints: 0, pick: "right" },
]);
/** The friend's game: four right without hints, and one miss (4,000), so the friend wins by 200 points. */
export const FRIEND_PLAN: readonly DuelRound[] = Object.freeze([
  { hints: 0, pick: "right" }, { hints: 0, pick: "right" }, { hints: 0, pick: "right" }, { hints: 0, pick: "miss" }, { hints: 0, pick: "right" },
]);

/** A whole game played off camera by plan, round by round to each verdict. */
const playGame = (plan: readonly DuelRound[]): Step[] => plan.flatMap(({ hints, pick }, index) => [
  ...(index > 0 ? [click("Next round")] : []),
  roundOf(index + 1),
  ...Array.from({ length: hints }, (_, hint) => click(`Reveal hint ${hint + 1}`)),
  pickStep(pick),
  click("Lock in answer"),
  verdict,
]);

/**
 * The friend's round on camera: both round tracks over the round, then the lock, and the reveal that says how the
 * challenger did on it. The first round's caption explains the strip.
 */
const duelRound = (index: number, { pick }: DuelRound): Step[] => [
  ...(index > 0 ? [click("Next round")] : []),
  roundOf(index + 1),
  jumpTo(".arcade-shell", "start"),
  ...(index === 0 ? [caption("Ana’s rounds stay hidden until you answer."), wait(1600)] : [wait(900)]),
  jumpTo("fieldset"),
  wait(300),
  pickStep(pick),
  wait(300),
  click("Lock in answer"),
  verdict,
  jumpTo(".reveal h2"),
  wait(1300),
];

/**
 * A duel (#173): a challenger plays the duel's deal off camera and sends a challenge link; the friend opens it, plays
 * the same five beside the challenger's strip, and ends on the comparison and the result link to send back.
 */
export const DUEL_SCENE: Scene = Object.freeze({
  id: "duel",
  gif: { width: 340, framesPerSecond: 10, maximumColors: 64 },
  challenge: Object.freeze({
    name: "Ana",
    steps: Object.freeze([
      goto(`/?deck=${DUEL_DEAL.deck}&deal=${DUEL_DEAL.seed}&game=0&design=off&theme=paper&layer=on`),
      ...playGame(CHALLENGER_PLAN),
    ]),
  }),
  steps: Object.freeze<Step[]>([
    { kind: "openChallenge" },
    { kind: "expectHeading", pattern: "^Ana challenges you$" },
    wait(400),
    caption("A friend sent you a challenge."),
    wait(2200),
    caption("Same five rounds. Same hints."),
    wait(1400),
    link("Play the same five"),
    ...FRIEND_PLAN.flatMap((round, index) => [...duelRound(index, round), ...(index === 0 ? [caption("")] : [])]),
    { kind: "expectHeading", pattern: "^You win by 200 points$" },
    jumpTo(".duel-comparison", "start"),
    caption("Then send your result back."),
    wait(2800),
    caption(""),
    wait(300),
  ]),
});

export const SCENES: readonly Scene[] = Object.freeze([
  DEMO_SCENE,
  deckScene("project", {
    opening: "Which project is this from?",
    hint: "Hints cost points.",
    answer: "Four popular repos. Pick one.",
  }, "right", { width: 340, maximumColors: 64 }),
  deckScene("language", {
    opening: "Name the language.",
    hint: "The hint marks the lines that decide it.",
    answer: "Lock in your call.",
  }, "right", { width: 360, maximumColors: 80 }, { layer: "on" }),
  deckScene("algorithm", {
    opening: "Which algorithm is this?",
    hint: "Its own name is hidden.",
    trace: "Hint 2 steps through it.",
    answer: "Four of one family. Pick one.",
  }, "right", { width: 330, framesPerSecond: 10, maximumColors: 72 }, { layer: "on" }),
  deckScene("framework", {
    opening: "One to-do app, many frameworks.",
    hint: "Their names are hidden.",
    answer: "Which framework wrote this?",
  }, "right", { width: 340, maximumColors: 88 }),
  deckScene("exercise", {
    opening: "Which exercise does this solve?",
    hint: "Real Exercism solutions.",
    answer: "Four exercises. Pick one.",
  }, "right", { width: 360, maximumColors: 80 }, { wrap: true }),
  deckScene("before-after", {
    opening: "Before or after the refactor?",
    hint: "The hint quotes the commit.",
    answer: "Which version is newer?",
  }, "right", { width: 340, maximumColors: 80 }),
  // The one miss among the deck clips: its round's first wrong option is the edge case the function's code hides.
  deckScene("output", {
    opening: "What does the last line return?",
    hint: "Hints work other calls.",
    answer: "Trace it, then lock it in.",
  }, "miss", { width: 360, maximumColors: 96 }, { wrap: true }),
  deckScene("fix", {
    opening: "A real bug fix changed one line.",
    hint: "The hint names the kind of change.",
    answer: "Which line was it?",
  }, "right", { width: 340, maximumColors: 80 }),
  deckScene("missing-line", {
    opening: "One line is missing.",
    hint: "Stuck? Take a hint.",
    answer: "Which line fills the gap?",
  }, "right", { width: 360, maximumColors: 80 }, { wrap: true }),
  deckScene("name-function", {
    opening: "Its name is hidden.",
    hint: "Hints cost points.",
    answer: "What did its author call it?",
  }, "right", { width: 360, maximumColors: 80 }, { wrap: true }),
  DUEL_SCENE,
  {
    id: "full-run",
    gif: { speed: 2, framesPerSecond: 8, width: 340, maximumColors: 48 },
    mp4: "codeguessr-demo",
    steps: [
      goto(CHOOSER),
      { kind: "expectHeading", pattern: "^Pick a deck$" },
      wait(500),
      caption("Ten decks of real code. Five rounds a game."),
      wait(1800),
      caption("Or today’s five: one mix for everyone."),
      wait(1400),
      link(DAILY_CARD),
      roundOf(1),
      caption("Read, guess, score."),
      wait(1000),
      ...playRound(1, 1),
      click("Next round"),
      ...playRound(2, 0),
      click("Next round"),
      ...playRound(3, 0),
      click("Next round"),
      ...playRound(4, 0),
      click("Next round"),
      ...playRound(5, 0),
      { kind: "expectText", pattern: "Run complete" },
      caption("Each round names its deck."),
      { kind: "scrollTo", selector: ".game-summary" },
      wait(2000),
      caption("Share it, or challenge a friend."),
      { kind: "scrollTo", selector: ".duel-challenge" },
      wait(2200),
      caption(""),
      link("Choose another deck"),
      { kind: "expectHeading", pattern: "^Pick a deck$" },
      // A caption lives in its page, so the chooser's comes once it has loaded.
      { kind: "expectText", pattern: "^Day streak 1$" },
      caption("Your streak stays in this browser."),
      wait(2400),
      caption(""),
      wait(600),
    ],
  },
]);
