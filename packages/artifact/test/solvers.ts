import type { ParsedFixture } from "../src/index";

/**
 * Solvers that never read the code: each sees only what a player sees before answering (the options and their
 * details). Accuracy is the expected share of rounds answered correctly, with ties split evenly.
 */
export const TOLERANCE = 0.1;

export const optionKey = (fixture: ParsedFixture): string => fixture.candidates.map(({ label }) => label).sort().join("|");
export const answerOf = (fixture: ParsedFixture): string => fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
export const chance = (fixture: ParsedFixture): number => 1 / fixture.candidates.length;

/** Expected accuracy of a solver that scores each option and picks the best, splitting ties evenly. */
export const accuracy = (fixtures: readonly ParsedFixture[], score: (fixture: ParsedFixture, label: string, index: number) => number): number =>
  fixtures.reduce((total, fixture, index) => {
    const scores = fixture.candidates.map(({ label }) => score(fixture, label, index));
    const best = Math.max(...scores);
    const winners = fixture.candidates.filter((_, position) => scores[position] === best);
    return total + (winners.some(({ label }) => label === answerOf(fixture)) ? 1 / winners.length : 0);
  }, 0) / fixtures.length;

/** Leave one out: how often each option was the answer in every other round showing the same options. */
export const sameOptionsSolver = (fixtures: readonly ParsedFixture[]) => (fixture: ParsedFixture, label: string, index: number): number =>
  fixtures.filter((other, position) => position !== index && optionKey(other) === optionKey(fixture) && answerOf(other) === label).length;

/** How often each option appears anywhere in the pool. */
export const frequencySolver = (fixtures: readonly ParsedFixture[]) => (_fixture: ParsedFixture, label: string): number =>
  fixtures.filter((other) => other.candidates.some((candidate) => candidate.label === label)).length;
/** The reverse: an option seen in many rounds may be a decoy the pool reuses. */
export const raritySolver = (fixtures: readonly ParsedFixture[]) => (fixture: ParsedFixture, label: string): number =>
  -frequencySolver(fixtures)(fixture, label);

/** The option that sorts first by label, a stand-in for any fixed preference among the labels. */
export const alphabeticalSolver = (fixture: ParsedFixture, label: string): number =>
  -[...fixture.candidates.map(({ label: other }) => other)].sort().indexOf(label);
