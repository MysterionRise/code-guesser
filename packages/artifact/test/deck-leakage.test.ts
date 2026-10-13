import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BEFORE_AFTER_CANDIDATE_IDS, LANGUAGE_PAIRS, parseArtifactDecks, type ParsedDeck, type ParsedFixture } from "../src/index";

/**
 * Leakage: solvers that never read the code must do no better than chance plus ten points. Each solver sees
 * only what a player sees before answering (the options and their details); none of them looks at the panes.
 * Accuracy is the expected share of rounds answered correctly, with ties split evenly.
 */
const TOLERANCE = 0.1;
const committed = (): readonly ParsedDeck[] =>
  parseArtifactDecks(JSON.parse(readFileSync(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url), "utf8")));
const decks = committed();
const deck = (id: ParsedDeck["id"]) => decks.find((candidate) => candidate.id === id);

const optionKey = (fixture: ParsedFixture): string => fixture.candidates.map(({ label }) => label).sort().join("|");
const answerOf = (fixture: ParsedFixture): string => fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
const chance = (fixture: ParsedFixture): number => 1 / fixture.candidates.length;

/** Expected accuracy of a solver that scores each option and picks the best, splitting ties evenly. */
const accuracy = (fixtures: readonly ParsedFixture[], score: (fixture: ParsedFixture, label: string, index: number) => number): number =>
  fixtures.reduce((total, fixture, index) => {
    const scores = fixture.candidates.map(({ label }) => score(fixture, label, index));
    const best = Math.max(...scores);
    const winners = fixture.candidates.filter((_, position) => scores[position] === best);
    return total + (winners.some(({ label }) => label === answerOf(fixture)) ? 1 / winners.length : 0);
  }, 0) / fixtures.length;

/** Leave one out: how often each option was the answer in every other round showing the same options. */
const sameOptionsSolver = (fixtures: readonly ParsedFixture[]) => (fixture: ParsedFixture, label: string, index: number): number =>
  fixtures.filter((other, position) => position !== index && optionKey(other) === optionKey(fixture) && answerOf(other) === label).length;

/** How often each option appears anywhere in the pool. */
const frequencySolver = (fixtures: readonly ParsedFixture[]) => (_fixture: ParsedFixture, label: string): number =>
  fixtures.filter((other) => other.candidates.some((candidate) => candidate.label === label)).length;
/** The reverse: an option seen in many rounds may be a decoy the pool reuses. */
const raritySolver = (fixtures: readonly ParsedFixture[]) => (fixture: ParsedFixture, label: string, index: number): number =>
  -frequencySolver(fixtures)(fixture, label, index);

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

  it.runIf(deck("before-after") !== undefined)("the later version is not found by always picking one pane", () => {
    const { fixtures } = deck("before-after")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const pane of BEFORE_AFTER_CANDIDATE_IDS) {
      const share = fixtures.filter(({ correctCandidateId }) => correctCandidateId === pane).length / fixtures.length;
      expect(share).toBeLessThanOrEqual(limit);
    }
  });
});
