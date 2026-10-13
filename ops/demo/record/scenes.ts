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

/**
 * One hard cut of the vertical demo: open a deck under a title sticker, read the question and the code, lock in
 * the right answer (after a hint, or with the chosen line highlighted, where asked), and pop the points.
 */
const demoCut = (deck: string, title: string, points: string, extras: Readonly<{ hint?: boolean; highlight?: boolean }> = {}): Step[] => [
  goto(`/?deck=${deck}`),
  { kind: "expectText", pattern: "Round 1 of 5" },
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

/** The README's headline clip: a vertical, captioned tour of all six decks, each round answered right. */
export const DEMO_SCENE: Scene = Object.freeze({
  id: "demo",
  viewport: Object.freeze({ width: 360, height: 640 }),
  captionStyle: "sticker" as const,
  // Hard cuts only: the game's arrival animation would spend frames on every page load.
  reducedMotion: "reduce" as const,
  // The headline clip gets a larger budget than the per-deck clips (under 10 MB): native width, smooth pops.
  gif: { width: 360, framesPerSecond: 15, maximumColors: 128, speed: 1.2 },
  steps: Object.freeze<Step[]>([
    goto("/"),
    { kind: "expectHeading", pattern: "^Pick a deck$" },
    caption("Can you read code like a detective?"),
    wait(1500),
    jumpTo(".deck-list", "start"),
    caption("6 decks. Real open-source code."),
    wait(1400),
    ...demoCut("algorithm", "1/6 · Which algorithm?", "Named it. +1,000"),
    ...demoCut("fix", "2/6 · Spot the bug fix", "With a hint. +800", { hint: true, highlight: true }),
    ...demoCut("output", "3/6 · Predict the output", "Traced it. +1,000"),
    ...demoCut("language", "4/6 · Which language?", "Nailed it. +1,000"),
    ...demoCut("before-after", "5/6 · Before or after?", "Newer one. +500"),
    ...demoCut("project", "6/6 · Which project?", "Right repo. +1,000"),
    goto("/"),
    { kind: "expectHeading", pattern: "^Pick a deck$" },
    jumpTo(".deck-list", "start"),
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

/** One deck's teaser: open it through the deck parameter, take a hint, and lock in an answer. */
const deckScene = (
  deck: "project" | "language" | "before-after" | "algorithm" | "output" | "fix",
  captions: Readonly<{ opening: string; hint: string; answer: string }>,
  answerIndex: number,
  gif: Partial<GifOptions> = {},
): Scene => ({
  id: `deck-${deck}`,
  gif,
  steps: [
    goto(`/?deck=${deck}`),
    { kind: "expectText", pattern: "Round 1 of 5" },
    wait(500),
    caption(captions.opening),
    wait(2200),
    caption(captions.hint),
    wait(500),
    click("Reveal hint 1"),
    wait(1500),
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
    hint: "Stuck? Take a hint.",
    answer: "Lock in your call.",
  }, ANSWER_CHOREOGRAPHY[1] ?? 0, { width: 360, maximumColors: 96 }),
  deckScene("before-after", {
    opening: "Before or after the refactor?",
    hint: "The hint quotes the commit.",
    answer: "Which version is newer?",
  }, Math.min(ANSWER_CHOREOGRAPHY[3] ?? 1, 1), { width: 360, maximumColors: 96 }),
  deckScene("algorithm", {
    opening: "Which algorithm is this?",
    hint: "Its own name is hidden.",
    answer: "Four of one family. Pick one.",
  }, ANSWER_CHOREOGRAPHY[2] ?? 0, { width: 360, maximumColors: 96 }),
  deckScene("output", {
    opening: "What does the last line return?",
    hint: "Hints work other calls.",
    answer: "Trace it, then lock it in.",
  }, ANSWER_CHOREOGRAPHY[4] ?? 0, { width: 360, maximumColors: 96 }),
  deckScene("fix", {
    opening: "A real bug fix changed one line.",
    hint: "The hint names the kind of change.",
    answer: "Which line was it?",
  }, ANSWER_CHOREOGRAPHY[3] ?? 1, { width: 360, maximumColors: 96 }),
  {
    id: "full-run",
    gif: { speed: 2, framesPerSecond: 8, width: 340, maximumColors: 48 },
    mp4: "codeguessr-demo",
    steps: [
      goto("/"),
      { kind: "expectHeading", pattern: "^Pick a deck$" },
      wait(500),
      caption("Six decks of real code. Five rounds a game."),
      wait(1800),
      link("Which project?"),
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
