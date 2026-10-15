import { readFileSync } from "node:fs";

import {
  codeNamesExercise, copyNamesExercise, exerciseCandidateId, familyDeckRule, labelStems, parseArtifactDecks, validateExercise,
  type FamilyMember,
} from "../../../packages/artifact/src/index";
import { composeExperimentArtifact } from "./compose";
import { generateExerciseRounds } from "./exercise-rounds";
import { exerciseWindow } from "./function-windows";
import { parseCrawlProfile, poolSizes } from "./profile";
import { EXERCISE_SECTION, composeInput, exerciseCandidates, exerciseFiles, loadCuratedProfile, snapshotIdFor } from "./testdata/deck-builders";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { exercise: true });
const candidates = () => exerciseCandidates(profile, snapshotIdFor(profile));
const limits = { maxLines: 18, maxBytes: 4096, minBytes: 80 };
const GRIDS = ["Matrix", "Minesweeper", "Saddle points", "Word search"];
const gridTerms = { names: [...GRIDS, "matrix", "saddle"], symbols: [], stems: GRIDS.flatMap(labelStems) };

describe("exercise windows (#58)", () => {
  it("skips Go's package line and masks every option of the family, in strings too", () => {
    const window = exerciseWindow([
      "package matrix", "", "import \"strings\"", "", "type Matrix [][]int", "",
      "func New(s string) (Matrix, error) {", "\tlines := strings.Split(s, \"\\n\")", "\tm := make(Matrix, len(lines))",
      "\treturn m, nil", "}",
    ].join("\n"), "Go", gridTerms, limits, ["Matrix", "matrix"])!;
    expect(window.excerpt.split("\n")[0]).toBe("func New(s string) (Mystery, error) {");
    expect(window.excerpt).not.toMatch(/package|matrix/iu);
  });

  it("opens at the answer's own definition, a Go method's included, never at a decoy's", () => {
    // Go's saddle-points solution opens with the matrix exercise's parser, under a decoy's name.
    const saddle = [
      "package saddlepoints", "", "type Matrix [][]int", "", "func New(s string) (*Matrix, error) {", "\tm := Matrix{}",
      "\tfor _, line := range strings.Split(s, \"\\n\") {", "\t\tm = append(m, parse(line))", "\t}", "\treturn &m, nil", "}", "",
      "func (m *Matrix) Saddle() (p []Pair) {", "\tcols := m.Cols()", "\tfor r, row := range *m {", "\t\tfor _, c := range maxs(row) {",
      "\t\t\tif isMin(cols[c], r) {", "\t\t\t\tp = append(p, Pair{r + 1, c + 1})", "\t\t\t}", "\t\t}", "\t}", "\treturn p", "}",
    ].join("\n");
    const window = exerciseWindow(saddle, "Go", gridTerms, limits, ["Saddle points", "saddle"])!;
    expect(window.excerpt.split("\n")[0]).toBe("func (m *Mystery) Mystery() (p []Pair) {");
    expect(window.windowStart).toBe(13);
  });

  it("names an exercise in code by its names, symbols, or label stems, and in prose by its label's words", () => {
    const squares = { label: "Difference of squares", names: ["differenceofsquares"], symbols: [] };
    expect(codeNamesExercise("def sum_of_squares(n):", squares)).toBe(true);
    expect(codeNamesExercise("def square_of_sum(n):", squares)).toBe(false);
    // `squares` in a hint would point to its exercise, though no identifier spells the label.
    expect(copyNamesExercise("It doubles a count on each of the 64 squares of a board.", squares)).toBe(true);
    expect(copyNamesExercise("It doubles a count on each of the 64 cells of a board.", squares)).toBe(false);
    expect(copyNamesExercise("One for you, one for me.", { label: "Two-fer", names: ["twofer"] })).toBe(false);
  });
});

describe("exercise profile (#58)", () => {
  const raw = () => JSON.parse(readFileSync(new URL("../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));

  it("reads the section the v6 run will configure: six tracks, six families, two rounds per exercise", () => {
    const real = JSON.parse(readFileSync(new URL("./testdata/exercise-section.json", import.meta.url), "utf8"));
    const parsed = parseCrawlProfile({ ...raw(), curated: real });
    expect(poolSizes(parsed).exercise).toBe(48);
    expect(parsed.curated!.exercise!.tracks).toHaveLength(6);
    expect(poolSizes(parseCrawlProfile(raw())).exercise).toBe(0);
  });

  it("refuses a hint with an option's label word, a solution path the slug does not name, and an odd pool", () => {
    const withSection = (section: unknown) => parseCrawlProfile({ ...raw(), curated: { repositories: [
      { repository: "algos/python", commit: "a".repeat(40), language: "Python" }, { repository: "algos/go", commit: "b".repeat(40), language: "Go" },
    ], exercise: section } });
    const section = () => structuredClone(EXERCISE_SECTION) as any;
    expect(() => withSection(section())).not.toThrow();
    const worded = section();
    worded.families[1].exercises[3].idea = "Every fourth year adds a day, as perfect timekeeping needs.";
    expect(() => withSection(worded)).toThrow();
    const fixed = section();
    fixed.tracks[0].solution = "exercises/practice/isogram/.meta/example.py";
    expect(() => withSection(fixed)).toThrow();
    const odd = section();
    odd.rounds = 12;
    expect(() => withSection(odd)).toThrow();
  });
});

describe("exercise rounds (#58)", () => {
  it("offers each round its family of four in text order and answers each exercise once per family, tracks taking turns", () => {
    const { fixtures } = generateExerciseRounds({ profile, candidates: candidates() });
    expect(fixtures).toHaveLength(8);
    for (const fixture of fixtures) {
      const labels = fixture.candidates.map(({ label }) => label);
      expect(labels).toEqual([...labels].sort());
    }
    expect(new Set(fixtures.map(({ correctCandidateId }) => correctCandidateId)).size).toBe(8);
    expect(new Set(candidates().map(({ language }) => language))).toEqual(new Set(["Python", "Go"]));
  });

  it("falls back to the next track when one has no solution, and refuses code that still names an option", () => {
    const files = new Map(exerciseFiles());
    files.delete("algos/go:exercises/practice/pangram/.meta/example.go");
    const fallback = exerciseCandidates(profile, snapshotIdFor(profile), files);
    expect(fallback.find(({ exercise }) => exercise === "pangram")!.language).toBe("Python");
    const named = candidates().map((candidate) => candidate.exercise !== "isogram" ? candidate
      : { ...candidate, excerpt: `${candidate.excerpt}\n# an isogram check`, excerptHash: "" });
    expect(() => generateExerciseRounds({ profile, candidates: named })).toThrow();
  });

  it("composes rounds the shared parser accepts, and the parser refuses a mixed family, a named option, or an uneven family", () => {
    const { artifact } = composeExperimentArtifact(composeInput(profile));
    const [deck] = parseArtifactDecks(artifact).filter(({ id }) => id === "exercise");
    expect(deck!.fixtures).toHaveLength(8);
    const exercises = new Map<string, FamilyMember>((artifact.crawlSnapshot as any).curated.exercises.map((entry: FamilyMember) => [entry.id, entry]));
    const fixture = deck!.fixtures[0]!;
    const semantics = { exercises, panes: fixture.panes, prompt: fixture.prompt, candidates: fixture.candidates, clues: fixture.clues,
      correctCandidateId: fixture.correctCandidateId, source: fixture.source };
    expect(() => validateExercise(semantics)).not.toThrow();
    const outsider = fixture.candidates[0]!.id === fixture.correctCandidateId ? 1 : 0;
    const mixed = fixture.candidates.map((candidate, index) => index !== outsider ? candidate
      : { id: exerciseCandidateId(fixture.candidates.some(({ label }) => label === "Leap") ? "isogram" : "leap"),
        label: fixture.candidates.some(({ label }) => label === "Leap") ? "Isogram" : "Leap", detail: null });
    expect(() => validateExercise({ ...semantics, candidates: mixed })).toThrow();
    const decoy = fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.label;
    expect(() => validateExercise({ ...semantics, clues: [fixture.clues[0]!, `Not ${decoy}.`] })).toThrow();
    expect(() => familyDeckRule(deck!.fixtures)).not.toThrow();
    const uneven = deck!.fixtures.map((round) => round.roundId === fixture.roundId ? round : { ...round,
      correctCandidateId: round.candidates.some(({ id }) => id === fixture.correctCandidateId) ? fixture.correctCandidateId : round.correctCandidateId });
    expect(() => familyDeckRule(uneven)).toThrow();
  });
});
