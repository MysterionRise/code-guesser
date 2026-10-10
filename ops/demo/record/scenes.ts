import type { GifOptions } from "./encode";

/** One scripted interaction with the running game. */
export type Step =
  | Readonly<{ kind: "goto"; path: string }>
  | Readonly<{ kind: "caption"; text: string }>
  | Readonly<{ kind: "click"; name: string }>
  | Readonly<{ kind: "link"; name: string }>
  | Readonly<{ kind: "choose"; index: number }>
  | Readonly<{ kind: "expectText"; pattern: string }>
  | Readonly<{ kind: "expectHeading"; pattern: string }>
  | Readonly<{ kind: "scrollTo"; selector: string }>
  | Readonly<{ kind: "wait"; milliseconds: number }>;

export interface Scene {
  /** Output basename under docs/media. */
  readonly id: string;
  readonly gif: Partial<GifOptions>;
  /** When set, the same screencast is also encoded to this MP4 basename. */
  readonly mp4?: string;
  readonly steps: readonly Step[];
}

const caption = (text: string): Step => ({ kind: "caption", text });
const click = (name: string): Step => ({ kind: "click", name });
const link = (name: string): Step => ({ kind: "link", name });
const goto = (path: string): Step => ({ kind: "goto", path });
const choose = (index: number): Step => ({ kind: "choose", index });
const wait = (milliseconds: number): Step => ({ kind: "wait", milliseconds });
const verdict: Step = { kind: "expectHeading", pattern: "^(?:Nice read\\.|Not this time\\.)$" };

/**
 * Answer index per round. The recorder never reads private round data, so the
 * indexes are a fixed choreography rather than known-correct answers; a wrong
 * pick shows the "Not this time." branch, which is part of the demo.
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
  deck: "project" | "language" | "ai",
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
  deckScene("project", {
    opening: "Which project is this from?",
    hint: "Hints cost points.",
    answer: "Four real repos. Pick one.",
  }, ANSWER_CHOREOGRAPHY[0] ?? 0),
  deckScene("language", {
    opening: "Name the language.",
    hint: "Stuck? Take a hint.",
    answer: "Lock in your call.",
  }, ANSWER_CHOREOGRAPHY[1] ?? 0, { width: 360, maximumColors: 96 }),
  deckScene("ai", {
    opening: "Is this AI-generated?",
    hint: "Answers come from AI credits in the commit.",
    answer: "Credited, or not?",
  }, Math.min(ANSWER_CHOREOGRAPHY[3] ?? 1, 1), { width: 360, maximumColors: 96 }),
  {
    id: "full-run",
    gif: { speed: 2, framesPerSecond: 12, width: 360, maximumColors: 80 },
    mp4: "codeguessr-demo",
    steps: [
      goto("/"),
      { kind: "expectHeading", pattern: "^Pick a deck$" },
      wait(500),
      caption("Three decks. Five real rounds each."),
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
