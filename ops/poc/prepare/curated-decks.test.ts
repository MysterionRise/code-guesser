import { readFileSync } from "node:fs";

import { CURATED_DECK_IDS, isCuratedDeck } from "./curated-deck-ids";
import { CURATED_DECKS, curatedDeck } from "./curated-decks";
import { generateAlgorithmRounds } from "./algorithm-rounds";
import { generateFixRounds } from "./fix-rounds";
import { generateOutputRounds } from "./output-rounds";
import { loadCuratedProfile } from "./testdata/deck-builders";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), "utf8");

describe("the curated deck registry (#36)", () => {
  it("runs the curated decks in their order, each with its own generator", () => {
    expect(CURATED_DECKS.map(({ id }) => id)).toEqual([...CURATED_DECK_IDS]);
    expect(curatedDeck("algorithm").generate).toBe(generateAlgorithmRounds);
    expect(curatedDeck("output").generate).toBe(generateOutputRounds);
    expect(curatedDeck("fix").generate).toBe(generateFixRounds);
    expect(CURATED_DECK_IDS.every(isCuratedDeck)).toBe(true);
    expect(["project", "language", "before-after"].some(isCuratedDeck)).toBe(false);
  });

  it("runs a deck only when the profile's curated section, keyed by its id, configures it", () => {
    const fixOnly = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    expect(CURATED_DECKS.filter((deck) => deck.configured(fixOnly)).map(({ id }) => id)).toEqual(
      CURATED_DECK_IDS.filter((id) => fixOnly.curated?.[id] !== undefined));
    expect(CURATED_DECKS.some((deck) => deck.configured({ ...fixOnly, curated: undefined } as never))).toBe(false);
  });

  it("leaves no curated deck's selection, generation, or titles wired by name outside the registry", () => {
    // Composition still reads the algorithm deck's entries for containment and each deck's pins for the snapshot,
    // which belong to the artifact's schema (#129), not to the deck wiring.
    for (const name of ["pipeline.ts", "types.ts", "dependencies.ts", "compose.ts"]) {
      expect(read(name), name).not.toMatch(/\b(?:select|generate)(?:Algorithm|Output|Fix)\b|curated\?\.(?:algorithm|output|fix)\?\.templates\b/u);
    }
  });
});
