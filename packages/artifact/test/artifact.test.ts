import { describe, expect, it } from "vitest";

import { composeExperimentArtifact } from "../../../ops/poc/prepare/compose";
import { composeInput } from "../../../ops/poc/prepare/testdata/deck-builders";
import { artifactHash, DECK_IDS, ExperimentRecordError, parseArtifactDecks, parseExperimentArtifact, roundPoints } from "../src/index";

const composed = (): any => structuredClone(composeExperimentArtifact(composeInput()).artifact);

describe("shared artifact model", () => {
  it("parses the preparer's artifact, and both sides hash it the same way", () => {
    const { artifact, artifactHash: preparerHash } = composeExperimentArtifact(composeInput());
    // Curated decks need a curated profile; this one has none.
    expect(parseArtifactDecks(artifact).map(({ id }) => id)).toEqual(DECK_IDS.filter((id) => !["algorithm", "output", "fix", "missing-line", "name-function", "framework"].includes(id)));
    expect(artifactHash(artifact)).toBe(preparerHash);
    expect(Object.isFrozen(parseExperimentArtifact(structuredClone(artifact)))).toBe(true);
  });

  it("accepts any non-empty subset of decks in deck order and nothing else", () => {
    for (const kept of [[0], [1], [2], [0, 1], [0, 2], [1, 2]]) {
      const value = composed();
      value.decks = kept.map((index) => value.decks[index]);
      expect(parseArtifactDecks(value).map(({ id }) => id)).toEqual(kept.map((index) => DECK_IDS[index]));
    }
    for (const decks of [[], [2, 0], [1, 1]]) {
      const value = composed();
      value.decks = decks.map((index) => value.decks[index]);
      expect(() => parseArtifactDecks(value)).toThrow(ExperimentRecordError);
    }
  });

  it("makes guessing at random worth 250 points a round on every deck", () => {
    expect([roundPoints(4, 0), roundPoints(4, 1), roundPoints(4, 2)]).toEqual([1000, 800, 500]);
    expect([roundPoints(2, 0), roundPoints(2, 1), roundPoints(2, 2)]).toEqual([500, 400, 250]);
    expect(roundPoints(4, 0) / 4).toBe(roundPoints(2, 0) / 2);
  });
});
