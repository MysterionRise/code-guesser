import { composeExperimentArtifact } from "./compose";
import {
  ExperimentRecordError, echoesArgument, outputCandidateId, parseExperimentArtifact, transformGivesAway, transformLimit, transformScore,
  transformsArgument,
} from "./model";
import { answerRanks, askable, balancedAnswers, generateOutputRounds } from "./output-rounds";
import { composeInput, loadCuratedProfile, outputCandidates, sha256, snapshotIdFor } from "./testdata/deck-builders";
import { parseArtifactDecks } from "../../../packages/artifact/src/index";
import {
  TOLERANCE, accuracy, alphabeticalSolver, chance, frequencySolver, raritySolver, sameOptionsSolver,
} from "../../../packages/artifact/test/solvers";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { output: true });
const v6 = loadCuratedProfile({}, { output: true }, "local-real-rounds.v6");
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
    const answers = balancedAnswers(pool, profile.profileVersion)!;
    for (const order of [0, 1]) {
      const ranks = pool.map((examples, index) => orders(examples.map(({ output }) => output), examples[answers[index]!]!.output)[order]!);
      expect([0, 1, 2, 3].map((rank) => ranks.filter((value) => value === rank).length)).toEqual([2, 2, 2, 2]);
    }
    expect(pool[7]![answers[7]!]!.call).not.toBe("f(0)");
    // Two rounds whose text order shifts every rank by one, and two whose orders agree: no choice fills both.
    expect(balancedAnswers([["1", "2", "3", "4"], ["5", "6", "7", "8"], ["9", "10", "11", "12"], ["99", "100", "101", "102"]].map(round),
      profile.profileVersion)).toBeUndefined();
    expect(balancedAnswers([round(["1", "2", "3", "4"])], profile.profileVersion)).toBeUndefined();
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

  it("reads an output off its call's arguments when it reorders their numbers, or is a piece or an anagram of them (#78)", () => {
    for (const [call, output] of [["reverse_letters(\"nohtyP is nohtyP\", 2)", "'Python is Python'"], ["capitalize(\"a\")", "'A'"],
      ["xor_swap(-1, 1)", "(1, -1)"], ["f(123)", "'123'"], ["f([3, 1, 2])", "[1, 2, 3]"], ["f(\"Hello World\")", "'world'"]]) {
      expect(transformsArgument(call!, output!), `${call} ${output}`).toBe(true);
    }
    // A number is never read as a piece of the arguments, and new letters are no rearrangement.
    for (const [call, output] of [["f(15)", "5"], ["f(-5)", "5"], ["f(2, 3)", "5"], ["f(\"ab\")", "'abc'"], ["f(\"abc\")", "'xyz'"],
      ["f([3, 1, 2])", "[1, 2]"]]) {
      expect(transformsArgument(call!, output!), `${call} ${output}`).toBe(false);
    }
    // It gives the answer away only when no other option is such a transform too.
    expect(transformGivesAway("capitalize(\"a\")", "'A'", ["'A'", "'B'", "'C'", "'D'"])).toBe(true);
    expect(transformGivesAway("first_word(\"jumped a\")", "'jumped'", ["'jumped'", "'a'", "'x'", "'y'"])).toBe(false);
    expect(transformGivesAway("capitalize(\"a\")", "'B'", ["'A'", "'B'", "'C'", "'D'"])).toBe(false);
  });

  it("from profile v6 on, never asks about a call that alone rearranges its arguments, and v5 still does (#78)", () => {
    const swaps = [["1, 2", "(2, 1)"], ["3, 4", "(4, 3)"], ["5, 6", "(6, 5)"], ["7, 8", "(8, 7)"]].map(([argument, output]) => ({ call: `xor_swap(${argument})`, output: output! }));
    expect(swaps.map((_, index) => askable(swaps, index, profile.profileVersion))).toEqual([true, true, true, true]);
    expect(swaps.map((_, index) => askable(swaps, index, v6.profileVersion))).toEqual([false, false, false, false]);
    // A round whose answer reads off its call fails the v6 generator, and passes v5's.
    const transformed = (candidates: ReturnType<typeof pool>) => candidates.map((candidate) => {
      if (!candidate.path.startsWith("strings/")) return candidate;
      const answer = { call: candidate.answer.call.replace(/\("(.)"\)$/u, () => `("${candidate.answer.output.slice(1, -1).toUpperCase()}")`),
        output: candidate.answer.output };
      const excerpt = `${candidate.code}\n\n>>> ${answer.call}`;
      return { ...candidate, answer, excerpt, excerptHash: sha256(excerpt) };
    });
    expect(() => generateOutputRounds({ profile: v6, candidates: transformed(outputCandidates(v6, snapshotIdFor(v6))) }))
      .toThrow("OUTPUT_ANSWER_TRANSFORMED");
    expect(generateOutputRounds({ profile, candidates: transformed(pool()) }).fixtures).toHaveLength(8);
  });

  it("from profile v6 on, keeps the transform solver within chance and a tenth over the deck's worded rounds (#78)", () => {
    // Two rounds whose first two outputs are pieces of every call, then two whose last two are, and again: answering
    // each round's next rank in turn would pick a transform every time.
    const round = (call: string) => ["'a'", "'bb'", "'ccc'", "'dddd'"].map((output) => ({ call, output }));
    const rounds = [0, 1].flatMap(() => [round('f("A BB")'), round('f("A BB")'), round('f("CCC DDDD")'), round('f("CCC DDDD")')]);
    const scored = (answers: readonly number[]) => rounds.reduce((sum, examples, index) =>
      sum + transformScore(examples[answers[index]!]!.call, examples[answers[index]!]!.output, examples.map(({ output }) => output)), 0);
    expect(scored(balancedAnswers(rounds, profile.profileVersion)!)).toBe(4);
    const answers = balancedAnswers(rounds, v6.profileVersion)!;
    expect(scored(answers)).toBeLessThanOrEqual(transformLimit(8));
    expect([0, 1, 2, 3].map((rank) => answers.filter((answer) => answer === rank).length)).toEqual([2, 2, 2, 2]);
    // No option a transform: the solver can only guess, a quarter.
    expect(transformScore("f(1)", "'x'", ["'x'", "'y'", "'z'", "'w'"])).toBe(0.25);

    // Every string round's call holds its answer and one decoy in capitals: each a coin toss, too many for the limit.
    const paired = (candidates: ReturnType<typeof pool>) => candidates.map((candidate) => {
      if (!candidate.path.startsWith("strings/")) return candidate;
      const answer = { call: `${candidate.functionName}("${[candidate.answer, candidate.decoys[0]!].map(({ output }) => output.slice(1, -1).toUpperCase()).join(" ")}")`,
        output: candidate.answer.output };
      const excerpt = `${candidate.code}\n\n>>> ${answer.call}`;
      return { ...candidate, answer, excerpt, excerptHash: sha256(excerpt) };
    });
    expect(() => generateOutputRounds({ profile: v6, candidates: paired(outputCandidates(v6, snapshotIdFor(v6))) })).toThrow("OUTPUT_TRANSFORM_UNBALANCED");
    expect(generateOutputRounds({ profile, candidates: paired(outputCandidates(profile, snapshotId)) }).fixtures).toHaveLength(8);
  });

  it("parses a v6 output deck only when no answer alone transforms its call's arguments and the transform solver stays in bounds (#78)", () => {
    const composed = new Map([profile, v6].map((from) => [from, composeExperimentArtifact(composeInput(from)).artifact] as const));
    const artifact = (from: typeof profile): any => structuredClone(composed.get(from));
    const strings = (value: any) => value.decks.find(({ id }: any) => id === "output").fixtures.filter(({ source }: any) => source.path.startsWith("strings/"));
    const call = (fixture: any, letters: readonly string[]) => {
      fixture.source.call = `${fixture.source.functionName}("${letters.map((label) => label.slice(1, -1).toUpperCase()).join(" ")}")`;
      fixture.panes[0].text = fixture.panes[0].text.replace(/>>> .*$/u, `>>> ${fixture.source.call}`);
      fixture.source.excerptHash = sha256(fixture.panes[0].text);
    };
    const answerOf = (fixture: any) => fixture.candidates.find(({ id }: any) => id === fixture.correctCandidateId).label;
    // One round's call moved to its answer in capitals: `repeat_2("CC")` shows 'cc'.
    const shout = (value: any) => { call(strings(value)[0], [answerOf(strings(value)[0])]); return value; };
    // Every string round's call holds its answer and one decoy in capitals.
    const pair = (value: any) => {
      for (const fixture of strings(value)) call(fixture, [answerOf(fixture), fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).label]);
      return value;
    };
    expect(() => parseExperimentArtifact(artifact(v6))).not.toThrow();
    for (const mutate of [shout, pair]) {
      expect(() => parseExperimentArtifact(mutate(artifact(v6)))).toThrow(ExperimentRecordError);
      expect(() => parseExperimentArtifact(mutate(artifact(profile)))).not.toThrow();
    }
  });

  it("from profile v6 on, offers one round per idea, and v5 does not ask (#84)", () => {
    // The second number module renamed for the first one's idea: `add_60_more` beside `add_60`.
    const numbers = (names: readonly string[]) => names.filter((name) => name.startsWith("add_"));
    const [kept, moved] = numbers(pool().map(({ functionName }) => functionName)) as [string, string];
    const renamed = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(`${moved}(`, `${kept}_more(`));
    const alikeCandidates = (candidates: ReturnType<typeof pool>) => candidates.map((candidate) => {
      if (candidate.functionName !== moved) return candidate;
      const changed = { ...renamed(candidate), functionName: `${kept}_more` };
      return { ...changed, excerptHash: sha256(changed.excerpt) };
    });
    expect(() => generateOutputRounds({ profile: v6, candidates: alikeCandidates(outputCandidates(v6, snapshotIdFor(v6))) }))
      .toThrow("OUTPUT_IDEA_REPEATED");
    expect(generateOutputRounds({ profile, candidates: alikeCandidates(pool()) }).fixtures).toHaveLength(8);
    // The parser holds a v6 deck to it too.
    const composed = new Map([profile, v6].map((from) => [from, composeExperimentArtifact(composeInput(from)).artifact] as const));
    const alike = (from: typeof profile): any => {
      const value: any = structuredClone(composed.get(from));
      const fixtures = value.decks.find(({ id }: any) => id === "output").fixtures;
      const index = fixtures.findIndex(({ source }: any) => source.functionName === moved);
      const changed = renamed(fixtures[index]);
      changed.source.functionName = `${kept}_more`;
      changed.source.excerptHash = sha256(changed.panes[0].text);
      fixtures[index] = changed;
      return value;
    };
    expect(() => parseExperimentArtifact(alike(v6))).toThrow(ExperimentRecordError);
    expect(() => parseExperimentArtifact(alike(profile))).not.toThrow();
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
