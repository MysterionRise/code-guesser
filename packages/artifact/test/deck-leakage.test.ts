import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BEFORE_AFTER_CANDIDATE_IDS, LANGUAGE_PAIRS, parseArtifactDecks, type ParsedDeck, type ParsedFixture } from "../src/index";
import {
  TOLERANCE, accuracy, alphabeticalSolver, answerOf, chance, frequencySolver, raritySolver, sameOptionsSolver,
} from "./solvers";

/**
 * Leakage: solvers that never read the code must do no better than chance plus ten points. Each solver sees
 * only what a player sees before answering (the options and their details); none of them looks at the panes.
 * Accuracy is the expected share of rounds answered correctly, with ties split evenly.
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

  it.runIf(deck("algorithm") !== undefined)("algorithm options are whole families, each member the answer once", () => {
    const { fixtures } = deck("algorithm")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const solver of [sameOptionsSolver(fixtures), frequencySolver(fixtures), raritySolver(fixtures), alphabeticalSolver]) {
      expect(accuracy(fixtures, solver)).toBeLessThanOrEqual(limit);
    }
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

  it.runIf(deck("before-after") !== undefined)("the later version is not found by always picking one pane", () => {
    const { fixtures } = deck("before-after")!;
    const limit = chance(fixtures[0]!) + TOLERANCE;
    for (const pane of BEFORE_AFTER_CANDIDATE_IDS) {
      const share = fixtures.filter(({ correctCandidateId }) => correctCandidateId === pane).length / fixtures.length;
      expect(share).toBeLessThanOrEqual(limit);
    }
  });
});
