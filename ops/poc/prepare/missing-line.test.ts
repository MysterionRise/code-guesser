import {
  GAP_MARKER, lineKind, missingLineCandidateId, missingLinePairHint, parseArtifactDecks, validateMissingLine,
} from "../../../packages/artifact/src/index";
import { composeExperimentArtifact } from "./compose";
import { balancedBrackets, gapChoices, statementStarts } from "./missing-line-window";
import { generateMissingLineRounds } from "./missing-line-rounds";
import { composeInput, loadCuratedProfile, missingLineCandidates, missingLineFiles, snapshotIdFor } from "./testdata/deck-builders";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { "missing-line": true });
const file = [...missingLineFiles().values()][0]!;

const candidates = () => missingLineCandidates(profile, snapshotIdFor(profile));

describe("missing-line windows (#57)", () => {
  it("hides one line away from the window's edges and offers three lines from elsewhere at the same indentation", () => {
    const choices = gapChoices(file, "seed", 8);
    expect(choices.length).toBeGreaterThan(0);
    const lines = file.split("\n");
    for (const choice of choices) {
      const pane = choice.excerpt.split("\n");
      const gap = choice.gapLine - choice.windowStart + 1;
      expect(pane).toHaveLength(8);
      expect(pane.filter((line) => line.trim() === GAP_MARKER)).toHaveLength(1);
      expect(pane[gap - 1]!.trim()).toBe(GAP_MARKER);
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(6);
      expect(lines[choice.gapLine - 1]!.trim()).toBe(choice.answer);
      const indent = /^ */u.exec(lines[choice.gapLine - 1]!)![0];
      for (const decoy of choice.decoys) {
        expect(pane.map((line) => line.trim())).not.toContain(decoy);
        expect(lines.find((line) => line.trim() === decoy)!.startsWith(indent) && !lines.find((line) => line.trim() === decoy)!.startsWith(`${indent} `)).toBe(true);
      }
      // The first hint names what the answer does; another option does the same, so it never picks the answer.
      expect(choice.decoys.some((decoy) => lineKind(decoy) === lineKind(choice.answer))).toBe(true);
    }
  });

  it("reads what a line does, and whether its brackets close", () => {
    expect(["return total", "for x in y:", "if a < b:", "total = sum(r)", "x += 1", "result.append(v)", "pass"].map(lineKind))
      .toEqual(["RETURN", "LOOP", "CONDITION", "ASSIGN", "ASSIGN", "CALL", "OTHER"]);
    expect(lineKind("if x == y:")).toBe("CONDITION");
    expect(lineKind("ok = a <= b")).toBe("ASSIGN");
    expect(lineKind("print(a == b)")).toBe("CALL");
    expect(balancedBrackets("f(a[0], {b: (c)})")).toBe(true);
    expect(balancedBrackets("f(a[0]")).toBe(false);
    expect(balancedBrackets("s = \"(\"")).toBe(true);
    // A line inside a bracket an earlier line opened is part of that statement, never a statement of its own.
    expect(statementStarts(["def f(", "    a: int,", "    b: int,", ") -> int:", "    x = (1 +", "         2)", "    return x"]))
      .toEqual([true, false, false, false, true, false, true]);
  });
});

describe("missing-line rounds (#57)", () => {
  it("generates rounds the shared parser accepts, with options in text order and hints that narrow without deciding", () => {
    expect(generateMissingLineRounds({ profile, candidates: candidates() }).fixtures).toHaveLength(8);
    const { artifact } = composeExperimentArtifact(composeInput(profile));
    const [deck] = parseArtifactDecks(artifact).filter(({ id }) => id === "missing-line");
    expect(deck!.fixtures).toHaveLength(8);
    for (const fixture of deck!.fixtures) {
      const labels = fixture.candidates.map(({ label }) => label);
      expect(labels).toEqual([...labels].sort());
      expect(fixture.clues[1]).toMatch(/^It is either “.+” or “.+”\.$/u);
    }
  });

  it("refuses a round whose pane shows an option, whose first hint decides, or whose gap is out of place", () => {
    const fixture = generateMissingLineRounds({ profile, candidates: candidates() }).fixtures[0]!;
    const semantics = { panes: fixture.panes, candidates: fixture.candidates, clues: fixture.clues, correctCandidateId: fixture.correctCandidateId, source: fixture.source as any };
    expect(() => validateMissingLine(semantics)).not.toThrow();
    const decoy = fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.label;
    expect(() => validateMissingLine({ ...semantics, panes: [{ label: null, text: `${fixture.panes[0]!.text}\n${decoy}` }] })).toThrow();
    expect(() => validateMissingLine({ ...semantics, source: { ...semantics.source, gapLine: Number(semantics.source.gapLine) + 1 } })).toThrow();
    const lonely = fixture.candidates.map((candidate) => candidate.id === fixture.correctCandidateId ? candidate
      : { ...candidate, label: `${candidate.label} # x`, id: missingLineCandidateId(`${candidate.label} # x`) });
    expect(() => validateMissingLine({ ...semantics, candidates: lonely })).toThrow();
  });

  it("from profile v7 on, pairs the answer with a line that does what it does, so both hints still leave two (#200)", () => {
    const v7 = loadCuratedProfile({}, { "missing-line": true }, "local-real-rounds.v7");
    const answerOf = (fixture: any): string => fixture.candidates.find(({ id }: any) => id === fixture.correctCandidateId).label;
    const pairedOf = (fixture: any): string => {
      const [, first, second] = /^It is either “(.+)” or “(.+)”\.$/u.exec(fixture.clues[1])!;
      return first === answerOf(fixture) ? second! : first!;
    };
    const decided = (fixtures: readonly any[]) => fixtures.filter((fixture) => lineKind(pairedOf(fixture)) !== lineKind(answerOf(fixture))).length;
    // Before v7 the second hint could pair the answer with a line the first hint rules out, as `a_star.py` did.
    expect(decided(generateMissingLineRounds({ profile, candidates: candidates() }).fixtures)).toBeGreaterThan(0);
    const { fixtures } = generateMissingLineRounds({ profile: v7, candidates: missingLineCandidates(v7, snapshotIdFor(v7)) });
    expect(decided(fixtures)).toBe(0);
    const [deck] = parseArtifactDecks(composeExperimentArtifact(composeInput(v7)).artifact).filter(({ id }) => id === "missing-line");
    expect(deck!.fixtures).toHaveLength(8);
    // The parser holds a v7 round to it, and an earlier round to its own rules.
    const fixture = fixtures.find((round) => round.candidates.some(({ label }) => lineKind(label) !== lineKind(answerOf(round))))!;
    const other = fixture.candidates.find(({ label }) => lineKind(label) !== lineKind(answerOf(fixture)))!.label;
    const semantics = { panes: fixture.panes, candidates: fixture.candidates, correctCandidateId: fixture.correctCandidateId, source: fixture.source as any,
      clues: [fixture.clues[0]!, missingLinePairHint(answerOf(fixture), other)] };
    expect(() => validateMissingLine(semantics)).toThrow();
    expect(() => validateMissingLine({ ...semantics, source: { ...semantics.source, profileVersion: "local-real-rounds.v6" } })).not.toThrow();
  });
});
