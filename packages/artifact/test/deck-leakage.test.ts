import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BEFORE_AFTER_CANDIDATE_IDS, LANGUAGE_PAIRS, parseArtifactDecks, type ParsedDeck, type ParsedFixture } from "../src/index";
import {
  LINE_FEATURES, TOLERANCE, accuracy, alphabeticalSolver, answerOf, chance, frequencySolver, labelWordSolver, lineFeatureSolver,
  memoryPlayer, optionKey, pairLengthSolver, paneLines, paneOverlapSolver, paneSizeSolver, proseLines, raritySolver,
  replayBaseline, sameOptionsSolver, transformsArguments,
} from "./solvers";

/** How far a remembering player may beat remembering reveals alone (#81): three points, in game two and three. */
const MEMORY_SLACK = 0.03;
const memoryWithinReplay = (fixtures: readonly ParsedFixture[]): void => {
  for (const game of [2, 3]) {
    expect(memoryPlayer(fixtures, game), `game ${game}`)
      .toBeLessThanOrEqual(replayBaseline(fixtures.length, fixtures[0]!.candidates.length, game) + MEMORY_SLACK);
  }
};

/**
 * Leakage: solvers that never read the code as code must do no better than chance plus ten points. Each sees what
 * a player sees before answering (the options, their details, and the hints) and at most skims the pane for words,
 * lengths, or symbols. Accuracy is the expected share of rounds answered correctly, with ties split evenly. A known
 * leak that needs new source data is kept as an expected failure that names its issue.
 */
const committed = (): readonly ParsedDeck[] =>
  parseArtifactDecks(JSON.parse(readFileSync(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url), "utf8")));
const decks = committed();
const deck = (id: ParsedDeck["id"]) => decks.find((candidate) => candidate.id === id);

describe("deck leakage", () => {
  it.runIf(deck("language") !== undefined)("language options do not give the answer away", () => {
    const { fixtures } = deck("language")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    expect(accuracy(fixtures, sameOptionsSolver(fixtures))).toBeLessThanOrEqual(limit);
    expect(accuracy(fixtures, frequencySolver(fixtures))).toBeLessThanOrEqual(limit);
    expect(accuracy(fixtures, raritySolver(fixtures))).toBeLessThanOrEqual(limit);
    // Every option is a language the deck can answer, so none can be ruled out as impossible.
    const answerable = new Set(fixtures.map(answerOf));
    expect(fixtures.every((fixture) => fixture.candidates.every(({ label }) => answerable.has(label)))).toBe(true);
    // Every option arrives with its look-alike, so picking the one whose look-alike is offered finds nothing.
    const lookalikeOffered = (fixture: ParsedFixture, label: string): number => {
      const pair = LANGUAGE_PAIRS.find((members) => (members as readonly string[]).includes(label))!;
      return pair.every((member) => fixture.candidates.some((candidate) => candidate.label === member)) ? 1 : 0;
    };
    expect(accuracy(fixtures, lookalikeOffered)).toBeLessThanOrEqual(limit);
  });

  it.runIf(deck("language") !== undefined)("language option sets recur in at most two rounds, so remembering reveals barely helps (#81)", () => {
    const { fixtures } = deck("language")!;
    const counts = new Map<string, number>();
    for (const fixture of fixtures) counts.set(optionKey(fixture), (counts.get(optionKey(fixture)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    memoryWithinReplay(fixtures);
    // A player who had memorised the whole pool could still avoid a repeated set's other pair, since 24 rounds over
    // 15 possible sets must repeat some: 43.75%, where four-round sets once let it name every answer.
    const pairOf = (label: string) => LANGUAGE_PAIRS.find((pair) => (pair as readonly string[]).includes(label))!;
    const avoidSiblingPair = (fixture: ParsedFixture, label: string, index: number) => fixtures
      .some((other, at) => at !== index && optionKey(other) === optionKey(fixture) && (pairOf(answerOf(other)) as readonly string[]).includes(label)) ? 0 : 1;
    expect(accuracy(fixtures, avoidSiblingPair)).toBeLessThanOrEqual(0.4375);
  });

  it.runIf(deck("project") !== undefined)("remembering project reveals earns little beyond replaying them (#81)", () => {
    memoryWithinReplay(deck("project")!.fixtures);
  });

  it.runIf(deck("output") !== undefined)("remembering output or fix reveals earns nothing beyond replaying them", () => {
    memoryWithinReplay(deck("output")!.fixtures);
    if (deck("fix") !== undefined) memoryWithinReplay(deck("fix")!.fixtures);
  });

  // #81: six families of four, each member the answer once, so three reveals in a family give the fourth away;
  // breaking the families needs the two the profile left out, which the journal does not hold.
  it.runIf(deck("algorithm") !== undefined).fails("remembering algorithm reveals earns little beyond replaying them (#81)", () => {
    memoryWithinReplay(deck("algorithm")!.fixtures);
  });

  it.runIf(deck("project") !== undefined)("project options appear equally often, so counting them does not help", () => {
    const { fixtures } = deck("project")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    expect(accuracy(fixtures, frequencySolver(fixtures))).toBeLessThanOrEqual(limit);
    expect(accuracy(fixtures, raritySolver(fixtures))).toBeLessThanOrEqual(limit);
    expect(accuracy(fixtures, sameOptionsSolver(fixtures))).toBeLessThanOrEqual(limit);
    // Having a description says nothing about being the answer.
    expect(accuracy(fixtures, (fixture, label) => fixture.candidates.find((candidate) => candidate.label === label)!.detail === null ? 0 : 1))
      .toBeLessThanOrEqual(limit);
  });

  // #77: three panes still echo their own option's name or description (`Aws::SQS`, `Utility`, `React.Component`);
  // replacing them needs files the journal does not hold.
  it.runIf(deck("project") !== undefined).fails("project panes share no telling words with any option (#77)", () => {
    const { fixtures } = deck("project")!;
    expect(accuracy(fixtures, paneOverlapSolver)).toBeLessThanOrEqual(chance(fixtures[0]!) + TOLERANCE);
  });

  it.runIf(deck("algorithm") !== undefined)("algorithm options are whole families, each member the answer once", () => {
    const { fixtures } = deck("algorithm")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const solver of [sameOptionsSolver(fixtures), frequencySolver(fixtures), raritySolver(fixtures), alphabeticalSolver]) {
      expect(accuracy(fixtures, solver)).toBeLessThanOrEqual(limit);
    }
  });

  it.runIf(deck("algorithm") !== undefined)("algorithm code shows no option's label word or stem, so neither finding nor missing one helps", () => {
    const { fixtures } = deck("algorithm")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const direction of [1, -1] as const) expect(accuracy(fixtures, labelWordSolver(direction))).toBeLessThanOrEqual(limit);
    expect(fixtures.every((fixture) => fixture.candidates.every(({ label }) => labelWordSolver(1)(fixture, label) === 0))).toBe(true);
  });

  it.runIf(deck("output") !== undefined)("output answers fill every rank in shown and text order, so no fixed position or extreme finds them", () => {
    const { fixtures } = deck("output")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    const position = (index: number) => (fixture: ParsedFixture, label: string) =>
      fixture.candidates.findIndex((option) => option.label === label) === index ? 1 : 0;
    const textRank = (index: number) => (fixture: ParsedFixture, label: string) =>
      [...fixture.candidates.map((option) => option.label)].sort().indexOf(label) === index ? 1 : 0;
    for (const solver of [sameOptionsSolver(fixtures), frequencySolver(fixtures), raritySolver(fixtures), alphabeticalSolver,
      ...[0, 1, 2, 3].flatMap((index) => [position(index), textRank(index)])]) {
      expect(accuracy(fixtures, solver)).toBeLessThanOrEqual(limit);
    }
  });

  // #78: two functions (`xor_swap`, `reverse_letters`) return a rearrangement of their input whichever call a round
  // shows; replacing them needs files the journal does not hold.
  it.runIf(deck("output") !== undefined).fails("an output that rearranges the call's own arguments is no better a guess (#78)", () => {
    const fixtures = deck("output")!.fixtures.filter((fixture) => !fixture.candidates.every(({ label }) => Number.isFinite(Number(label))));
    expect(accuracy(fixtures, (fixture, label) => transformsArguments(fixture, label) ? 1 : 0)).toBeLessThanOrEqual(chance(fixtures[0]!) + TOLERANCE);
  });

  it.runIf(deck("fix") !== undefined)("fix answers take every position, centrality, and nearly every length rank equally", () => {
    const { fixtures } = deck("fix")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    const lineOf = (label: string) => Number(label.slice("Line ".length));
    const paneOf = (fixture: ParsedFixture) => fixture.panes[0]!.text.split("\n");
    const solvers = [
      ...[0, 1, 2, 3].map((index) => (fixture: ParsedFixture, label: string) => fixture.candidates.findIndex((option) => option.label === label) === index ? 1 : 0),
      (fixture: ParsedFixture, label: string) => -Math.abs(2 * lineOf(label) - paneOf(fixture).length - 1),
      (fixture: ParsedFixture, label: string) => Math.abs(2 * lineOf(label) - paneOf(fixture).length - 1),
      (fixture: ParsedFixture, label: string) => paneOf(fixture)[lineOf(label) - 1]!.trim().length,
      (fixture: ParsedFixture, label: string) => -paneOf(fixture)[lineOf(label) - 1]!.trim().length,
    ];
    for (const solver of solvers) expect(accuracy(fixtures, solver)).toBeLessThanOrEqual(limit);
  });

  it.runIf(deck("fix") !== undefined)("fix answers are no extreme of any line feature, no option is prose, and the hint's pair hides the longer line", () => {
    const { fixtures } = deck("fix")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    // The busiest line (most operators and brackets), the longest, the most indented, the one with most words used
    // once, and the reverse of each, ties split.
    for (const feature of Object.keys(LINE_FEATURES)) {
      for (const direction of [1, -1] as const) expect(accuracy(fixtures, lineFeatureSolver(feature, direction))).toBeLessThanOrEqual(limit);
    }
    // No option is a comment or docstring line a player could rule out, judged from the pane alone.
    expect(fixtures.flatMap((fixture) => fixture.candidates.filter(({ label }) => proseLines(paneLines(fixture)).has(Number(label.slice("Line ".length))))))
      .toEqual([]);
    // After the second hint two options are left: picking the longer or the shorter is a coin toss.
    for (const direction of [1, -1] as const) expect(accuracy(fixtures, pairLengthSolver(direction))).toBeLessThanOrEqual(0.5 + TOLERANCE);
  });

  // #75: the newer pane is usually the bigger one (75% by lines, 80% by characters); balancing it needs commits
  // the journal does not hold.
  it.runIf(deck("before-after") !== undefined).fails("the newer version is not the bigger pane (#75)", () => {
    const { fixtures } = deck("before-after")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const measure of [(text: string) => text.split("\n").length, (text: string) => text.length]) {
      for (const direction of [1, -1]) expect(accuracy(fixtures, paneSizeSolver((text) => direction * measure(text)))).toBeLessThanOrEqual(limit);
    }
  });

  it.runIf(deck("missing-line") !== undefined)("missing-line options give no edge by text, length, or names shared with the pane (#57)", () => {
    const { fixtures } = deck("missing-line")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    const names = (text: string) => new Set((text.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []).filter((name) => name.length > 1));
    const shared = (fixture: ParsedFixture, label: string) => [...names(label)].filter((name) => names(fixture.panes[0]!.text).has(name)).length;
    for (const direction of [1, -1]) {
      expect(accuracy(fixtures, (fixture, label) => direction * shared(fixture, label)), `shared ${direction}`).toBeLessThanOrEqual(limit);
      expect(accuracy(fixtures, (_fixture, label) => direction * label.length), `length ${direction}`).toBeLessThanOrEqual(limit);
      expect(accuracy(fixtures, (fixture, label) => direction * [...fixture.candidates.map((option) => option.label)].sort().indexOf(label)),
        `text ${direction}`).toBeLessThanOrEqual(limit);
    }
    // After the second hint two lines are left: picking the longer is a coin toss.
    const longerOfPair = (fixture: ParsedFixture, label: string) => {
      const [, first, second] = /^It is either “(.+)” or “(.+)”\.$/u.exec(fixture.clues[1]!)!;
      return label !== first && label !== second ? -1 : label.length;
    };
    expect(accuracy(fixtures, longerOfPair)).toBeLessThanOrEqual(0.5 + TOLERANCE);
    memoryWithinReplay(fixtures);
  });

  it.runIf(deck("before-after") !== undefined)("the later version is not found by always picking one pane", () => {
    const { fixtures } = deck("before-after")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const pane of BEFORE_AFTER_CANDIDATE_IDS) {
      const share = fixtures.filter(({ correctCandidateId }) => correctCandidateId === pane).length / fixtures.length;
      expect(share).toBeLessThanOrEqual(limit);
    }
  });
});
