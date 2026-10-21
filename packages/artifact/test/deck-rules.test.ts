import { describe, expect, it } from "vitest";

import { composeExperimentArtifact } from "../../../ops/poc/prepare/compose";
import { composeInput, loadCuratedProfile, loadRepeatedAlgorithmProfile } from "../../../ops/poc/prepare/testdata/deck-builders";
import {
  DECK_KINDS, ExperimentRecordError, FIX_ORDERS, deduplicationKeys, fixExtremeLimits, fixExtremeScores, fixRanks, fixSlack, labelStems,
  lineComplexity, pairLongerScore, parseArtifactDecks, rareWords, showsLabelStem,
} from "../src/index";

describe("algorithm decks that answer an algorithm more than once (#167)", () => {
  const composed = (profile = loadRepeatedAlgorithmProfile()): any => structuredClone(composeExperimentArtifact(composeInput(profile)).artifact);
  const algorithmDeck = (value: any) => value.decks.find(({ id }: any) => id === "algorithm");

  it("lets only a v7 deck repeat an algorithm id; every other kind keeps its keys", () => {
    for (const version of ["local-real-rounds.v5", "local-real-rounds.v6"] as const) {
      expect(deduplicationKeys("ALGORITHM", version)).toEqual(["path", "blob", "rawContentHash", "excerptHash", "algorithmId"]);
    }
    expect(deduplicationKeys("ALGORITHM", "local-real-rounds.v7")).toEqual(["path", "blob", "rawContentHash", "excerptHash"]);
    for (const kind of Object.values(DECK_KINDS).filter((kind) => kind !== "ALGORITHM")) {
      expect(deduplicationKeys(kind, "local-real-rounds.v7")).toEqual(deduplicationKeys(kind, "local-real-rounds.v6"));
    }
  });

  it("parses a v7 deck whose families answer each algorithm twice, once in each language", () => {
    const deck = parseArtifactDecks(composed()).find(({ id }) => id === "algorithm")!;
    expect(deck.fixtures).toHaveLength(16);
    const answers = new Map<string, string[]>();
    for (const { source } of deck.fixtures) answers.set(String(source.algorithmId), [...answers.get(String(source.algorithmId)) ?? [], String(source.language)]);
    expect([...answers.values()].every((languages) => [...languages].sort().join("|") === "Go|Python")).toBe(true);
  });

  it("refuses a v7 deck whose family answers unevenly, or answers an algorithm twice in one language", () => {
    const uneven = composed();
    algorithmDeck(uneven).fixtures.splice(0, 1);
    expect(() => parseArtifactDecks(uneven)).toThrow(ExperimentRecordError);
    const sameLanguage = composed();
    const go = algorithmDeck(sameLanguage).fixtures.find(({ source }: any) => source.language === "Go");
    go.source.language = "Python";
    expect(() => parseArtifactDecks(sameLanguage)).toThrow(ExperimentRecordError);
    // Before v7 the deck's own keys hold each algorithm to one answer, and its balance is the generator's.
    const v5 = composed(loadCuratedProfile());
    algorithmDeck(v5).fixtures.splice(0, 1);
    expect(() => parseArtifactDecks(v5)).not.toThrow();
  });
});

describe("algorithm label stems", () => {
  it("finds a label's stem inside any identifier, the answer's and a decoy's alike", () => {
    expect(labelStems("Heapsort")).toEqual(["heap"]);
    expect(labelStems("Counting sort")).toEqual(["count"]);
    expect(labelStems("Dijkstra's algorithm")).toEqual(["dijkstra"]);
    // The answer's stem in a helper's name, and in a variable.
    expect(showsLabelStem("        heapify(unsorted, i, n)", "Heapsort")).toBe(true);
    expect(showsLabelStem("int[] count = computeHistogram(array);", "Counting sort")).toBe(true);
    // A decoy's word left in view, which would rule that decoy out.
    expect(showsLabelStem("buckets: list[list] = [[] for _ in range(10)]", "Bucket sort")).toBe(true);
    expect(showsLabelStem("MIN_HEAP_SIZE = minheap", "Heapsort")).toBe(true);
    // The masked code shows none of them.
    expect(showsLabelStem("        mystery(unsorted, i, n)\nint[] mystery = computeHistogram(array);\nmysterys = []", "Heapsort")).toBe(false);
    expect(showsLabelStem("mysterys: list[list] = []", "Bucket sort")).toBe(false);
  });
});

describe("fix line features", () => {
  // Length 5, 15, 5, 21; operators and brackets 1, 5, 1, 3; indentation 0, 4, 4, 8; words used once 0, 0, 0, 2.
  const pane = ["x = 1", "    y = (x + 2) * 3", "    z = x", "        value = compute(y, z)"];
  const lines = [1, 2, 3, 4];

  it("ranks options by complexity as well as position, centrality, and length, with the same slack as length", () => {
    expect(pane.map(lineComplexity)).toEqual([1, 5, 1, 3]);
    expect(lineComplexity("if (a[i] > b)")).toBe(5);
    expect(FIX_ORDERS).toHaveLength(4);
    expect(fixSlack(24)).toEqual([0, 0, 2, 2]);
    // Simplest first, ties to the earlier line: 1, 3, 4, 2.
    expect(lines.map((answer) => fixRanks(answer, lines, pane)[3])).toEqual([0, 3, 1, 2]);
  });

  it("scores what picking the line with the most, or the least, of a feature wins, ties split", () => {
    expect(pane.map((line) => rareWords(line, pane))).toEqual([0, 0, 0, 2]);
    // Length, complexity, indentation, words used once: the most of each, then the least.
    expect(fixExtremeScores(2, lines, pane)).toEqual([0, 1, 0, 0, 0, 0, 0, 1 / 3]);
    expect(fixExtremeScores(4, lines, pane)).toEqual([1, 0, 1, 1, 0, 0, 0, 0]);
    expect(fixExtremeScores(1, lines, pane)).toEqual([0, 0, 0, 0, 1 / 2, 1 / 2, 1, 1 / 3]);
    expect(fixExtremeLimits(24)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  });

  it("scores the longer line of the second hint's pair", () => {
    expect([pairLongerScore(4, 1, pane), pairLongerScore(1, 4, pane), pairLongerScore(1, 3, pane)]).toEqual([1, 0, 0.5]);
  });
});
