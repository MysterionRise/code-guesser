import {
  NAME_SHAPE_HINTS, codeSpells, nameFunctionCandidateId, nameFunctionDeckRule, nameFunctionPairHint, nameShape, parseArtifactDecks,
  validateNameFunction,
} from "../../../packages/artifact/src/index";
import { composeExperimentArtifact } from "./compose";
import { declaredFunctions, nameChoices } from "./name-function-window";
import { generateNameFunctionRounds } from "./name-function-rounds";
import { composeInput, loadCuratedProfile, nameFunctionCandidates, nameFunctionFiles, snapshotIdFor } from "./testdata/deck-builders";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { "name-function": true });
const candidates = () => nameFunctionCandidates(profile, snapshotIdFor(profile));

const JAVA = [
  "public class Shapes {",
  "    private final int size;",
  "    public Shapes(int size) {", "        this.size = size;", "    }",
  "    @Override", "    public String toString() {", "        return \"Shapes\" + size;", "    }",
  "    abstract int area();",
  "    public static <T extends Comparable<T>> int binarySearch(T[] items, T key) {", "        int low = 0;",
  "        int high = items.length - 1;", "        return binarySearch(items, key, low, high);", "    }",
  "    private static int[] reversed(int[] values) {", "        int[] out = new int[values.length];",
  "        for (int i = 0; i < values.length; i++) {", "            out[values.length - 1 - i] = values[i];", "        }", "        return out;", "    }",
  "    int getSize() {", "        return size;", "    }",
  "    static int countPositive(int[] values) {", "        int n = 0;", "        for (int v : values) if (v > 0) n++;", "        return n;", "    }",
  "    static long product(int[] values) {", "        long p = 1;", "        for (int v : values) p *= v;", "        return p;", "    }",
  "}",
].join("\n");

describe("name-the-function windows (#73)", () => {
  it("finds the functions a file declares: Java methods but no constructor or declaration, Go functions and methods, Python defs", () => {
    expect(declaredFunctions(JAVA, "Java").map(({ name, inherited }) => `${name}${inherited ? "!" : ""}`))
      .toEqual(["toString!", "binarySearch", "reversed", "getSize", "countPositive", "product"]);
    const go = "func (h *Heap) push(v int) {\n\th.items = append(h.items, v)\n}\n\nfunc Sort[T any](items []T) []T {\n\treturn items\n}";
    expect(declaredFunctions(go, "Go").map(({ name, start, end }) => [name, start, end])).toEqual([["push", 0, 3], ["Sort", 4, 7]]);
    const python = "def outer(x):\n    def inner(y):\n        return y\n    return inner(x)\n\nclass A:\n    def __init__(self):\n        self.a = 1";
    expect(declaredFunctions(python, "Python").map(({ name, start, end }) => [name, start, end]))
      .toEqual([["outer", 0, 4], ["inner", 1, 3], ["__init__", 6, 8]]);
  });

  it("masks the name, its recursive calls included, and never offers a name the pane spells", () => {
    const file = [...nameFunctionFiles().values()][0]!;
    const choices = nameChoices(file, "Go", "seed", 12);
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) {
      expect(choice.excerpt.split("\n")[0]).toMatch(/^func mystery\(/u);
      for (const option of [choice.answer, ...choice.decoys]) expect(codeSpells(choice.excerpt, option)).toBe(false);
      // The first hint names how many words the answer joins; another option joins as many, so it never decides.
      expect(choice.decoys.some((decoy) => nameShape(decoy) === nameShape(choice.answer))).toBe(true);
    }
    const java = nameChoices(JAVA, "Java", "seed", 12);
    const search = java.find(({ answer }) => answer === "binarySearch");
    expect(search?.excerpt).toContain("return mystery(items, key, low, high);");
    expect(search?.excerpt.split("\n")[0]).toBe("public static <T extends Comparable<T>> int mystery(T[] items, T key) {");
    // `toString` is fixed by `Object`, so it is never an option.
    expect(java.flatMap(({ answer, decoys }) => [answer, ...decoys])).not.toContain("toString");
  });

  it("spells a name as an identifier or as a run of an identifier's words", () => {
    expect(codeSpells("x := mergeHalves(a)", "merge")).toBe(true);
    expect(codeSpells("x := binarySearchRange(a)", "binary_search")).toBe(true);
    expect(codeSpells("sorted := a", "sort")).toBe(false);
    expect(codeSpells("print(\"heapify\")", "heapify")).toBe(true);
  });
});

describe("name-the-function rounds (#73)", () => {
  it("generates rounds the shared parser accepts, with options in text order and hints that narrow without deciding", () => {
    expect(generateNameFunctionRounds({ profile, candidates: candidates() }).fixtures).toHaveLength(8);
    const { artifact } = composeExperimentArtifact(composeInput(profile));
    const [deck] = parseArtifactDecks(artifact).filter(({ id }) => id === "name-function");
    expect(deck!.fixtures).toHaveLength(8);
    let longer = 0;
    for (const fixture of deck!.fixtures) {
      const labels = fixture.candidates.map(({ label }) => label);
      const answer = fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
      expect(labels).toEqual([...labels].sort());
      expect(fixture.clues[0]).toBe(NAME_SHAPE_HINTS[nameShape(answer)]);
      const [, first, second] = /^It is either “(.+)” or “(.+)”\.$/u.exec(fixture.clues[1]!)!;
      const other = first === answer ? second! : first!;
      longer += answer.length > other.length ? 1 : answer.length === other.length ? 0.5 : 0;
    }
    // Picking the longer name of the second hint's pair is a coin toss over the deck.
    expect(longer).toBe(4);
  });

  it("refuses a pane that spells an option or masks another name, near-twin options, and a first hint that decides", () => {
    const fixture = generateNameFunctionRounds({ profile, candidates: candidates() }).fixtures[0]!;
    const semantics = { panes: fixture.panes, candidates: fixture.candidates, clues: fixture.clues, correctCandidateId: fixture.correctCandidateId, source: fixture.source as any };
    expect(() => validateNameFunction(semantics)).not.toThrow();
    const decoy = fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.label;
    const pane = (text: string) => ({ ...semantics, panes: [{ label: null, text }] });
    expect(() => validateNameFunction(pane(`${fixture.panes[0]!.text}\n// ${decoy}`))).toThrow();
    expect(() => validateNameFunction(pane(`${fixture.panes[0]!.text}\nvar x = Vectormystery{}`))).toThrow();
    expect(() => validateNameFunction(pane(fixture.panes[0]!.text.replace("mystery", "Mystery")))).toThrow();
    expect(() => validateNameFunction({ ...semantics, source: { ...semantics.source, functionName: decoy } })).toThrow();
    // A decoy that differs from the answer only in case (Go's `Merge` beside `merge`) is no choice reading decides.
    const answer = fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
    const twin = fixture.candidates.map((candidate) => candidate.label !== decoy ? candidate
      : { ...candidate, label: answer.toUpperCase(), id: nameFunctionCandidateId(answer.toUpperCase()) });
    expect(() => validateNameFunction({ ...semantics, candidates: twin })).toThrow();
    const shape = nameShape(answer);
    const alone = fixture.candidates.map((candidate) => {
      if (candidate.id === fixture.correctCandidateId || nameShape(candidate.label) !== shape) return candidate;
      const label = shape === "MORE" ? "zz" : `${candidate.label}AndMoreWords`;
      return { ...candidate, label, id: nameFunctionCandidateId(label) };
    });
    expect(() => validateNameFunction({ ...semantics, candidates: alone })).toThrow();
  });

  it("from profile v7 on, answers each name once and pairs it with a name of as many words (#200)", () => {
    const v7 = loadCuratedProfile({}, { "name-function": true }, "local-real-rounds.v7");
    const answerOf = (fixture: any): string => fixture.candidates.find(({ id }: any) => id === fixture.correctCandidateId).label;
    const pairedOf = (fixture: any): string => {
      const [, first, second] = /^It is either “(.+)” or “(.+)”\.$/u.exec(fixture.clues[1])!;
      return first === answerOf(fixture) ? second! : first!;
    };
    // The small profile's eight files declare the same six names, so before v7 some name is the answer twice.
    const v5 = generateNameFunctionRounds({ profile, candidates: candidates() }).fixtures;
    expect(new Set(v5.map(answerOf)).size).toBeLessThan(8);
    expect(() => generateNameFunctionRounds({ profile: v7, candidates: candidates() })).toThrow("NAME_FUNCTION_ANSWER_REPEATED");
    const [deck] = parseArtifactDecks(composeExperimentArtifact(composeInput(v7)).artifact).filter(({ id }) => id === "name-function");
    expect(new Set(deck!.fixtures.map(answerOf)).size).toBe(8);
    expect(deck!.fixtures.every((fixture) => nameShape(pairedOf(fixture)) === nameShape(answerOf(fixture)))).toBe(true);
    // The deck rule refuses a name answered twice from v7 on, ignoring case, and lets an earlier deck keep it.
    const twice = deck!.fixtures.map((fixture, index) => index !== 1 ? fixture : {
      ...fixture, correctCandidateId: nameFunctionCandidateId(answerOf(deck!.fixtures[0]!).toUpperCase()),
      candidates: fixture.candidates.map((candidate) => candidate.id !== fixture.correctCandidateId ? candidate
        : { ...candidate, label: answerOf(deck!.fixtures[0]!).toUpperCase(), id: nameFunctionCandidateId(answerOf(deck!.fixtures[0]!).toUpperCase()) }),
    });
    expect(() => nameFunctionDeckRule(deck!.fixtures)).not.toThrow();
    expect(() => nameFunctionDeckRule(twice)).toThrow();
    expect(() => nameFunctionDeckRule(twice.map((fixture) => ({ ...fixture, source: { ...fixture.source, profileVersion: "local-real-rounds.v6" } }))))
      .not.toThrow();
    // A v7 round whose second hint pairs the answer with a name of other length in words is refused.
    const fixture = deck!.fixtures.find((round) => round.candidates.some(({ label }) => nameShape(label) !== nameShape(answerOf(round))))!;
    const other = fixture.candidates.find(({ label }) => nameShape(label) !== nameShape(answerOf(fixture)))!.label;
    const semantics = { panes: fixture.panes, candidates: fixture.candidates, correctCandidateId: fixture.correctCandidateId, source: fixture.source as any,
      clues: [fixture.clues[0]!, nameFunctionPairHint(answerOf(fixture), other)] };
    expect(() => validateNameFunction(semantics)).toThrow();
    expect(() => validateNameFunction({ ...semantics, source: { ...semantics.source, profileVersion: "local-real-rounds.v6" } })).not.toThrow();
  });
});
