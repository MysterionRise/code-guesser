import type { GifOptions } from "./encode";

/** One scripted interaction with the running game. */
export type Step =
  | Readonly<{ kind: "goto" }>
  | Readonly<{ kind: "caption"; text: string }>
  | Readonly<{ kind: "click"; name: string }>
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

export const SCENES: readonly Scene[] = Object.freeze([
  {
    id: "01-read-the-code",
    gif: {},
    steps: [
      { kind: "goto" },
      { kind: "expectText", pattern: "Round 1 of 5" },
      wait(600),
      caption("Read the code."),
      wait(2200),
      caption("Reveal a hint. It costs points."),
      wait(600),
      click("Reveal hint 1"),
      wait(1400),
      click("Reveal hint 2"),
      wait(2000),
      caption(""),
      wait(300),
    ],
  },
  {
    id: "02-lock-in",
    gif: { width: 360, maximumColors: 96 },
    steps: [
      { kind: "goto" },
      { kind: "expectText", pattern: "Round 1 of 5" },
      wait(400),
      caption("Lock in your call."),
      { kind: "scrollTo", selector: "fieldset" },
      wait(900),
      choose(ANSWER_CHOREOGRAPHY[0] ?? 0),
      wait(900),
      click("Lock in answer"),
      verdict,
      caption("Fewer hints, more points."),
      { kind: "scrollTo", selector: ".reveal h2" },
      wait(2600),
      caption(""),
      wait(300),
    ],
  },
  {
    id: "03-full-run",
    gif: { speed: 2, framesPerSecond: 12, width: 360, maximumColors: 80 },
    mp4: "codeguessr-demo",
    steps: [
      { kind: "goto" },
      { kind: "expectText", pattern: "Round 1 of 5" },
      wait(500),
      caption("Five rounds. Read, guess, score."),
      wait(1200),
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
      wait(2600),
      click("Play again"),
      { kind: "expectText", pattern: "Round 1 of 5" },
      caption(""),
      wait(900),
    ],
  },
]);
