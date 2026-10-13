import { composeExperimentArtifact } from "./compose";
import { ExperimentRecordError, echoesArgument, outputCandidateId, parseExperimentArtifact } from "./model";
import { answerRanks, balancedAnswers, generateOutputRounds } from "./output-rounds";
import { composeInput, loadCuratedProfile, outputCandidates, sha256, snapshotIdFor } from "./testdata/deck-builders";
import { parseArtifactDecks } from "../../../packages/artifact/src/index";
import {
  TOLERANCE, accuracy, alphabeticalSolver, chance, frequencySolver, raritySolver, sameOptionsSolver,
} from "../../../packages/artifact/test/solvers";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { output: true });
const snapshotId = snapshotIdFor(profile);
const pool = () => outputCandidates(profile, snapshotId);
const outputDeck = () => parseArtifactDecks(composeExperimentArtifact(composeInput(profile)).artifact).find(({ id }) => id === "output")!;

describe("output rounds", () => {
  it("asks about one call, offers four outputs in rank order, and works two decoys as hints", () => {
    const { fixtures } = generateOutputRounds({ profile, candidates: pool() });
    expect(fixtures).toHaveLength(8);
    const fixture = fixtures.find(({ source }) => String(source.path).startsWith("maths/add_"))!;
    const step = Number(/add_(\d+)/u.exec(String(fixture.source.path))![1]);
    const result = (call: string) => String(Number(/\((\d+)\)$/u.exec(call)![1]) + step);
    expect(fixture.panes[0]!.text).toMatch(new RegExp(`^def add_${step}\\(value: int\\):\n {4}total = value\n {4}total \\+= ${step}\n {4}return total\n\n>>> add_${step}\\(\\d\\)$`, "u"));
    expect(fixture.candidates.map(({ label }) => label)).toEqual([1, 2, 3, 4].map((value) => String(value + step)));
    const call = fixture.source.call as string;
    expect(fixture.correctCandidateId).toBe(outputCandidateId(result(call)));
    expect(fixture.clues).toHaveLength(2);
    for (const clue of fixture.clues) {
      const [hintCall, output] = clue.split(" → ");
      expect(hintCall).not.toBe(call);
      expect(output).toBe(result(hintCall!));
    }
    expect(fixture.evidence).toBe(`The docstring in ${String(fixture.source.path)} of algos/python records ${call} as ${result(call)}.`);
  });

  it("rejects a pool whose answers do not fill every rank, and a candidate whose pane differs from its call", () => {
    const candidates = pool();
    expect(candidates.map(answerRanks)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [0, 0], [1, 1], [2, 2], [3, 3]]);
    const flipped = candidates.map((candidate, index) => {
      if (index !== 0) return candidate;
      const answer = candidate.decoys[2]!;
      const excerpt = `${candidate.code}\n\n>>> ${answer.call}`;
      return { ...candidate, answer, decoys: [candidate.answer, ...candidate.decoys.slice(0, 2)], excerpt, excerptHash: sha256(excerpt) };
    });
    expect(() => generateOutputRounds({ profile, candidates: flipped })).toThrow("OUTPUT_RANK_UNBALANCED");
    const stale = candidates.map((candidate, index) => index === 0 ? { ...candidate, answer: candidate.decoys[0]! , decoys: [candidate.answer, ...candidate.decoys.slice(1)] } : candidate);
    expect(() => generateOutputRounds({ profile, candidates: stale })).toThrow();
    expect(() => generateOutputRounds({ profile, candidates: candidates.slice(0, 7) })).toThrow();
  });

  it("balances answers over the shown order and text order together, never echoing an argument, or finds that it cannot", () => {
    const orders = (outputs: readonly string[], answer: string) =>
      [outputs.map(Number).sort((left, right) => left - right).map(String).indexOf(answer), [...outputs].sort().indexOf(answer)];
    // Each round's examples call `f` with an argument no output repeats, except the last round's `f(0)`.
    const round = (outputs: readonly string[]) => outputs.map((output, index) => ({ call: `f(${index === 3 && output === "0" ? 0 : 1000 + index})`, output }));
    const pool = [["1", "2", "3", "4"], ["9", "10", "11", "12"], ["5", "6", "7", "8"], ["99", "100", "101", "102"],
      ["20", "30", "40", "50"], ["7", "8", "9", "10"], ["31", "32", "33", "34"], ["-1", "-2", "3", "0"]].map(round);
    const answers = balancedAnswers(pool)!;
    for (const order of [0, 1]) {
      const ranks = pool.map((examples, index) => orders(examples.map(({ output }) => output), examples[answers[index]!]!.output)[order]!);
      expect([0, 1, 2, 3].map((rank) => ranks.filter((value) => value === rank).length)).toEqual([2, 2, 2, 2]);
    }
    expect(pool[7]![answers[7]!]!.call).not.toBe("f(0)");
    // Two rounds whose text order shifts every rank by one, and two whose orders agree: no choice fills both.
    expect(balancedAnswers([["1", "2", "3", "4"], ["5", "6", "7", "8"], ["9", "10", "11", "12"], ["99", "100", "101", "102"]].map(round))).toBeUndefined();
    expect(balancedAnswers([round(["1", "2", "3", "4"])])).toBeUndefined();
  });

  it("never asks about a call whose result repeats one of its arguments", () => {
    for (const [call, output] of [["f(6)", "6"], ["f([1, 7])", "7"], ["f(\"-1\")", "-1"], ["f(0, 0)", "0"], ["f(\"a\")", "'a'"], ["f((0, 0))", "(0, 0)"]]) {
      expect(echoesArgument(call!, output!)).toBe(true);
    }
    for (const [call, output] of [["f(-1)", "1"], ["f(16)", "6"], ["f(1.5)", "1"], ["f(\"ab\")", "'a'"], ["f(10)", "1"]]) {
      expect(echoesArgument(call!, output!)).toBe(false);
    }
    const candidates = outputCandidates(profile, snapshotId);
    const echoed = candidates.map((candidate, index) => {
      if (index !== 0) return candidate;
      const answer = { call: candidate.answer.call.replace(/\(.*\)/u, `(${candidate.answer.output})`), output: candidate.answer.output };
      const excerpt = `${candidate.code}\n\n>>> ${answer.call}`;
      return { ...candidate, answer, excerpt, excerptHash: sha256(excerpt) };
    });
    expect(() => generateOutputRounds({ profile, candidates: echoed })).toThrow("OUTPUT_ANSWER_ECHOED");
  });

  it("gives code-blind solvers no edge over chance, including the largest, smallest, longest, and shortest output", () => {
    const { fixtures } = outputDeck();
    const limit = chance(fixtures[0]!) + TOLERANCE;
    const position = (index: number) => (fixture: typeof fixtures[number], label: string) =>
      fixture.candidates.findIndex((option) => option.label === label) === index ? 1 : 0;
    const textRank = (index: number) => (fixture: typeof fixtures[number], label: string) =>
      [...fixture.candidates.map((option) => option.label)].sort().indexOf(label) === index ? 1 : 0;
    for (const solver of [sameOptionsSolver(fixtures), frequencySolver(fixtures), raritySolver(fixtures), alphabeticalSolver,
      ...[0, 1, 2, 3].flatMap((index) => [position(index), textRank(index)])]) {
      expect(accuracy(fixtures, solver)).toBeLessThanOrEqual(limit);
    }
  });

  it("parses only a pane that ends in its one call, outputs of one shape, and hints that work a decoy", () => {
    const base = (): any => structuredClone(composeExperimentArtifact(composeInput(profile)).artifact);
    const round = (value: any) => value.decks.find(({ id }: any) => id === "output").fixtures[0];
    const mutations: ((value: any) => void)[] = [
      // A second call in the pane.
      (value) => { const fixture = round(value); fixture.panes[0].text = fixture.panes[0].text.replace("\n\n>>>", "\n>>> f(1)\n\n>>>"); },
      // The call the source records is not the one shown.
      (value) => { round(value).source.call = round(value).clues[0].split(" → ")[0]; },
      // A hint that works the answer.
      (value) => {
        const fixture = round(value);
        const answer = fixture.candidates.find(({ id }: any) => id === fixture.correctCandidateId).label;
        fixture.clues[0] = `${fixture.clues[0].split(" → ")[0]} → ${answer}`;
      },
      // An option of another shape.
      (value) => { const fixture = round(value); const option = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId);
        option.label = "'text'"; option.id = outputCandidateId("'text'"); },
      // The answer moved off its balanced rank.
      (value) => { const fixture = round(value); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
    ];
    for (const mutate of mutations) {
      const changed = base();
      mutate(changed);
      expect(() => parseExperimentArtifact(changed)).toThrow(ExperimentRecordError);
    }
  });
});
