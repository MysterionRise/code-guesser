import type { GifOptions } from "./encode";
import type { CaptionStyle } from "./overlay";

/** One scripted interaction with the running game. */
export type Step =
  | Readonly<{ kind: "goto"; path: string }>
  // Checks the current round's right answer. The recorder reads it from the artifact on the Node side, as the
  // browser tests do; the page itself never learns it.
  | Readonly<{ kind: "answer" }>
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

const jumpTo = (selector: string, block: "start" | "center" = "center"): Step => ({ kind: "jumpTo", selector, block });

export const DECKS = Object.freeze([
  "project", "language", "algorithm", "framework", "exercise", "before-after", "output", "fix", "missing-line", "name-function",
] as const);
export type Deck = (typeof DECKS)[number];
type Theme = "terminal" | "paper" | "arcade" | "contrast";

/**
 * Each deck's recorded deal (#40): a fixed seed's first game, so every recording plays the same rounds. Each seed was
 * picked for a first round that reads well at a phone's width.
 */
export const DEAL_SEEDS: Readonly<Record<Deck, string>> = Object.freeze({
  project: "0000beef", language: "c0dec0de", algorithm: "c0dec0de", framework: "0000beef", exercise: "c0dec0de",
  "before-after": "5eed0002", output: "0000beef", fix: "c0dec0de", "missing-line": "5eed0002", "name-function": "c0dec0de",
});

/**
 * A deck's recorded game: its fixed deal with the static design and the theme and question layer asked for. The picks
 * are lab-mode queries, which `next dev` honours; the recorder checks the theme took.
 */
export const dealtPath = (deck: Deck, look: Readonly<{ theme?: Theme; layer?: "on" | "off" }> = {}): string =>
  `/?deck=${deck}&deal=${DEAL_SEEDS[deck]}&game=0&design=off&theme=${look.theme ?? "terminal"}&layer=${look.layer ?? "off"}`;
/** The chooser, with picks its links carry into the game they deal. */
const CHOOSER = "/?design=off&theme=terminal&layer=off";
/** The mixed game's card, by its description: the card's title alone also matches "the same mixed five". */
export const MIXED_CARD = "Five rounds, each from a different deck.";
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
 * Answer index per round in the per-deck and full-run scenes: a fixed choreography rather than known-correct
 * answers, so a wrong pick shows the "Not this time." branch. The vertical demo instead answers every round right
 * (`answer` steps).
 */
export const DEFAULT_ANSWER_CHOREOGRAPHY: readonly number[] = Object.freeze([0, 0, 0, 1, 0]);

/** Parses DEMO_ANSWERS ("0,1,1,0,1"): five radio indexes, one per round; blank means the default. */
export const parseAnswerChoreography = (value: string | undefined): readonly number[] => {
  if (value === undefined || value.trim() === "") return DEFAULT_ANSWER_CHOREOGRAPHY;
  const indexes = value.split(",").map((part) => Number(part.trim()));
  if (indexes.length !== 5 || indexes.some((index) => !Number.isInteger(index) || index < 0 || index > 3)) {
    throw new RangeError("DEMO_ANSWERS must list five radio indexes between 0 and 3");
  }
  return Object.freeze(indexes);
};

const ANSWER_CHOREOGRAPHY = parseAnswerChoreography(process.env.DEMO_ANSWERS);

const playRound = (round: number, hints: number): Step[] => [
  { kind: "expectText", pattern: `Round ${round} of 5` },
  ...Array.from({ length: hints }, (_, index) => [click(`Reveal hint ${index + 1}`), wait(700)]).flat(),
  choose(ANSWER_CHOREOGRAPHY[round - 1] ?? 0),
  wait(600),
  click("Lock in answer"),
  verdict,
  { kind: "scrollTo", selector: ".reveal h2" },
  wait(1400),
];

/**
 * One deck's teaser: open its recorded game, take a hint, and lock in an answer. With a `trace` caption it also buys
 * the second hint, a question layer's step-through, and steps it forward.
 */
const deckScene = (
  deck: Deck,
  captions: Readonly<{ opening: string; hint: string; trace?: string; answer: string }>,
  answerIndex: number,
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
    choose(answerIndex),
    wait(800),
    click("Lock in answer"),
    verdict,
    { kind: "scrollTo", selector: ".reveal h2" },
    wait(2600),
    caption(""),
    wait(300),
  ],
});

export const SCENES: readonly Scene[] = Object.freeze([
  DEMO_SCENE,
  deckScene("project", {
    opening: "Which project is this from?",
    hint: "Hints cost points.",
    answer: "Four popular repos. Pick one.",
  }, ANSWER_CHOREOGRAPHY[0] ?? 0, { width: 340, maximumColors: 64 }),
  deckScene("language", {
    opening: "Name the language.",
    hint: "The hint marks the lines that decide it.",
    answer: "Lock in your call.",
  }, ANSWER_CHOREOGRAPHY[1] ?? 0, { width: 360, maximumColors: 96 }, { layer: "on" }),
  deckScene("algorithm", {
    opening: "Which algorithm is this?",
    hint: "Its own name is hidden.",
    trace: "Hint 2 steps through it.",
    answer: "Four of one family. Pick one.",
  }, ANSWER_CHOREOGRAPHY[2] ?? 0, { width: 330, framesPerSecond: 10, maximumColors: 72 }, { layer: "on" }),
  deckScene("framework", {
    opening: "One to-do app, many frameworks.",
    hint: "Their names are hidden.",
    answer: "Which framework wrote this?",
  }, ANSWER_CHOREOGRAPHY[3] ?? 0, { width: 340, maximumColors: 88 }),
  deckScene("exercise", {
    opening: "Which exercise does this solve?",
    hint: "Real Exercism solutions.",
    answer: "Four exercises. Pick one.",
  }, ANSWER_CHOREOGRAPHY[4] ?? 0, { width: 360, maximumColors: 96 }, { wrap: true }),
  deckScene("before-after", {
    opening: "Before or after the refactor?",
    hint: "The hint quotes the commit.",
    answer: "Which version is newer?",
  }, Math.min(ANSWER_CHOREOGRAPHY[3] ?? 1, 1), { width: 340, maximumColors: 80 }),
  deckScene("output", {
    opening: "What does the last line return?",
    hint: "Hints work other calls.",
    answer: "Trace it, then lock it in.",
  }, ANSWER_CHOREOGRAPHY[4] ?? 0, { width: 360, maximumColors: 96 }, { wrap: true }),
  deckScene("fix", {
    opening: "A real bug fix changed one line.",
    hint: "The hint names the kind of change.",
    answer: "Which line was it?",
  }, ANSWER_CHOREOGRAPHY[3] ?? 1, { width: 340, maximumColors: 80 }),
  deckScene("missing-line", {
    opening: "One line is missing.",
    hint: "Stuck? Take a hint.",
    answer: "Which line fills the gap?",
  }, ANSWER_CHOREOGRAPHY[0] ?? 0, { width: 360, maximumColors: 96 }, { wrap: true }),
  deckScene("name-function", {
    opening: "Its name is hidden.",
    hint: "Hints cost points.",
    answer: "What did its author call it?",
  }, ANSWER_CHOREOGRAPHY[1] ?? 0, { width: 360, maximumColors: 96 }, { wrap: true }),
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
      caption("Or mix them: one round from each of five decks."),
      wait(1200),
      link(MIXED_CARD),
      { kind: "expectText", pattern: "Round 1 of 5" },
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
      caption("Share your score."),
      { kind: "scrollTo", selector: ".reveal p:last-of-type" },
      wait(2400),
      caption("Then try another deck."),
      wait(900),
      link("Choose another deck"),
      { kind: "expectHeading", pattern: "^Pick a deck$" },
      wait(1200),
      caption(""),
      wait(600),
    ],
  },
]);
