import { generateAlgorithmRounds } from "./algorithm-rounds";
import { composeExperimentArtifact } from "./compose";
import { algorithmCandidateId, ExperimentRecordError, parseExperimentArtifact } from "./model";
import { algorithmCandidates, composeInput, loadCuratedProfile, sha256, snapshotIdFor } from "./testdata/deck-builders";
import { parseArtifactDecks } from "../../../packages/artifact/src/index";
import {
  TOLERANCE, accuracy, alphabeticalSolver, chance, frequencySolver, raritySolver, sameOptionsSolver,
} from "../../../packages/artifact/test/solvers";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile();
const snapshotId = snapshotIdFor(profile);
const pool = () => algorithmCandidates(profile, snapshotId);
const families = profile.curated!.algorithm!.families;

describe("algorithm rounds", () => {
  it("offers each round its whole family, and each family answers each of its algorithms once", () => {
    const { fixtures } = generateAlgorithmRounds({ profile, candidates: pool() });
    expect(fixtures).toHaveLength(8);
    for (const family of families) {
      const ids = family.algorithms.map(({ id }) => algorithmCandidateId(id)).sort();
      const rounds = fixtures.filter((fixture) => fixture.candidates.some(({ id }) => ids.includes(id)));
      expect(rounds).toHaveLength(4);
      for (const fixture of rounds) expect(fixture.candidates.map(({ id }) => id).sort()).toEqual(ids);
      expect(rounds.map(({ correctCandidateId }) => correctCandidateId).sort()).toEqual(ids);
    }
    const quick = fixtures.find(({ source }) => source.algorithmId === "quick-sort")!;
    expect(quick.panes[0]!.text).toMatch(/^def mystery\(items\):/u);
    expect(quick.clues).toEqual(["It splits items around a pivot and recurses.", "O(n log n) on average."]);
    expect(quick.evidence).toBe("This is algorithms/quick_sort.py in algos/python; its own name, hidden here, is quick_sort.");
    expect(quick.misleadingSignals).toEqual([families[0]!.note]);
  });

  it("rejects a family answered unevenly, code that names an option, and a pool of the wrong size", () => {
    const candidates = pool();
    const uneven = candidates.map((candidate, index) => index === 1 ? { ...candidates[0]!, path: "algorithms/other.py",
      blob: "f".repeat(40), rawContentHash: "e".repeat(64), excerpt: `${candidates[0]!.excerpt}\n`, excerptHash: sha256(`${candidates[0]!.excerpt}\n`) } : candidate);
    expect(() => generateAlgorithmRounds({ profile, candidates: uneven })).toThrow("ALGORITHM_FAMILY_UNBALANCED");
    const named = candidates.map((candidate, index) => index === 0
      ? { ...candidate, excerpt: `${candidate.excerpt}\n# unlike insertion sort`, excerptHash: sha256(`${candidate.excerpt}\n# unlike insertion sort`) } : candidate);
    expect(() => generateAlgorithmRounds({ profile, candidates: named })).toThrow("ALGORITHM_NAME_SHOWN");
    expect(() => generateAlgorithmRounds({ profile, candidates: candidates.slice(0, 7) })).toThrow();
  });

  it("composes a fourth deck the shared parser accepts, with the pins and algorithms in the snapshot", () => {
    const composed = composeExperimentArtifact(composeInput(profile));
    expect(parseArtifactDecks(composed.artifact).map(({ id }) => id)).toEqual(["project", "language", "before-after", "algorithm"]);
    const snapshot = composed.artifact.crawlSnapshot as any;
    expect(snapshot.curated.pins.map(({ repository }: any) => repository)).toEqual(["algos/go", "algos/python"]);
    expect(snapshot.curated.algorithms.map(({ id }: any) => id)).toEqual([...families.flatMap(({ algorithms }) => algorithms.map(({ id }) => id))].sort());
  });

  it("gives code-blind solvers no edge over chance", () => {
    const deck = parseArtifactDecks(composeExperimentArtifact(composeInput(profile)).artifact).find(({ id }) => id === "algorithm")!;
    const limit = chance(deck.fixtures[0]!) + TOLERANCE;
    for (const solver of [sameOptionsSolver(deck.fixtures), frequencySolver(deck.fixtures), raritySolver(deck.fixtures), alphabeticalSolver]) {
      expect(accuracy(deck.fixtures, solver)).toBeLessThanOrEqual(limit);
    }
  });

  it("parses only options from one whole family, the answer's own file, and code with the name masked", () => {
    const base = (): any => structuredClone(composeExperimentArtifact(composeInput(profile)).artifact);
    const round = (value: any) => value.decks[3].fixtures[0];
    const mutations: ((value: any) => void)[] = [
      // An option from the other family.
      (value) => {
        const fixture = round(value);
        const outsider = families.flatMap(({ algorithms }) => algorithms).find(({ id }) => !fixture.candidates.some((option: any) => option.id === algorithmCandidateId(id)))!;
        const index = fixture.candidates.findIndex(({ id }: any) => id !== fixture.correctCandidateId);
        fixture.candidates[index] = { id: algorithmCandidateId(outsider.id), label: outsider.label, detail: null };
      },
      // The answer moved to another option of the family.
      (value) => {
        const fixture = round(value);
        fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id;
      },
      // The code shows the real name.
      (value) => { const fixture = round(value); fixture.panes[0].text = fixture.panes[0].text.replaceAll("mystery", fixture.source.functionName); },
      // A file outside the snapshot's pins.
      (value) => { round(value).source.commit = "9".repeat(40); },
      (value) => { round(value).candidates[0].detail = "A note"; },
    ];
    for (const mutate of mutations) {
      const changed = base();
      mutate(changed);
      expect(() => parseExperimentArtifact(changed)).toThrow(ExperimentRecordError);
    }
  });
});
