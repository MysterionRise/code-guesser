import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { artifactHash, DECK_IDS, ExperimentRecordError, parseArtifactDecks, parseExperimentArtifact } from "../src/index";

const committed = (): any => JSON.parse(readFileSync(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url), "utf8"));
const pinned = /TRUSTED_ARTIFACT_HASH = "([0-9a-f]{64})"/u.exec(
  readFileSync(new URL("../../../apps/game/src/demo/local-real-experiment.pin.server.ts", import.meta.url), "utf8"))![1];

describe("shared artifact model", () => {
  it("parses the committed artifact, whose canonical hash is the game's pin", () => {
    const value = committed();
    expect(parseArtifactDecks(value).map(({ id }) => id)).toEqual(DECK_IDS);
    expect(artifactHash(value)).toBe(pinned);
    expect(Object.isFrozen(parseExperimentArtifact(value))).toBe(true);
  });

  it("accepts any non-empty subset of decks in deck order and nothing else", () => {
    for (const kept of [[0], [1], [2], [0, 1], [0, 2], [1, 2]]) {
      const value = committed();
      value.decks = kept.map((index) => value.decks[index]);
      expect(parseArtifactDecks(value).map(({ id }) => id)).toEqual(kept.map((index) => DECK_IDS[index]));
    }
    for (const decks of [[], [2, 0], [1, 1]]) {
      const value = committed();
      value.decks = decks.map((index) => value.decks[index]);
      expect(() => parseArtifactDecks(value)).toThrow(ExperimentRecordError);
    }
  });

  it("binds language sources to the snapshot's Stack revision", () => {
    const value = committed();
    value.crawlSnapshot.stack.revision = "0".repeat(40);
    expect(() => parseArtifactDecks(value)).toThrow(ExperimentRecordError);
  });
});
