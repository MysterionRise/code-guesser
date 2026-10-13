import { generateLanguageRounds, LanguageRoundsError, validateLanguageCandidate } from "./language-rounds";
import { STACK_LANGUAGES } from "./profile";
import { deckCandidates, loadV3Profile, snapshotIdFor, stackCandidate } from "./testdata/v3-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadV3Profile();
const snapshotId = snapshotIdFor(profile);
const pool = () => deckCandidates(profile, snapshotId).language;

describe("language rounds v3", () => {
  it("offers each answer with three of the other answerable languages, never one outside them", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    expect(fixtures).toHaveLength(10);
    for (const fixture of fixtures) {
      const labels = fixture.candidates.map(({ label }) => label);
      expect(labels).toHaveLength(4);
      expect(labels.every((label) => (STACK_LANGUAGES as readonly string[]).includes(label))).toBe(true);
      expect(labels).toContain(fixture.source.configuration);
      expect(fixture.panes).toEqual([{ label: null, text: expect.any(String) }]);
      expect(fixture.candidates.every(({ detail }) => detail === null)).toBe(true);
    }
  });

  it("gives rounds with the same answer different option sets, so no option set names its answer", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    const setKey = (fixture: (typeof fixtures)[number]) => fixture.candidates.map(({ label }) => label).sort().join("|");
    for (const language of STACK_LANGUAGES) {
      const sets = fixtures.filter(({ source }) => source.configuration === language).map(setKey);
      expect(new Set(sets).size).toBe(sets.length);
    }
    // Any option set shared by two rounds belongs to rounds with different answers.
    const answers = new Map<string, Set<unknown>>();
    for (const fixture of fixtures) answers.set(setKey(fixture), new Set([...(answers.get(setKey(fixture)) ?? []), fixture.source.configuration]));
    const shared = fixtures.filter((fixture) => fixtures.filter((other) => setKey(other) === setKey(fixture)).length > 1);
    expect(shared.every((fixture) => answers.get(setKey(fixture))!.size > 1)).toBe(true);
  });

  it("leaves every language out equally often, so how often an option appears says nothing", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    const appearances = new Map<string, number>();
    for (const fixture of fixtures) for (const { label } of fixture.candidates) appearances.set(label, (appearances.get(label) ?? 0) + 1);
    expect([...appearances.values()]).toEqual(Array(5).fill(8));
  });

  it("draws both hints from the excerpt, naming no language", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    const go = fixtures.find(({ source }) => source.configuration === "Go" && String(source.path).endsWith("compute.go"))!;
    expect(go.clues).toEqual(["Blocks are wrapped in braces.", "Look for `:=` in the code."]);
    const python = fixtures.find(({ source }) => source.configuration === "Python" && String(source.path).endsWith("compute.py"))!;
    expect(python.clues).toEqual(["Blocks open with a colon and are set by indentation.", "Look for `elif` in the code."]);
    const ruby = fixtures.find(({ source }) => source.configuration === "Ruby" && String(source.path).endsWith("compute.rb"))!;
    expect(ruby.clues[0]).toBe("Blocks close with a line that says end.");
    for (const fixture of fixtures) {
      expect(fixture.clues.join(" ")).not.toMatch(/\b(?:Python|TypeScript|Go|Rust|Ruby)\b/u);
      expect(fixture.helpfulSignals).toHaveLength(1);
      expect(fixture.misleadingSignals).toHaveLength(1);
    }
  });

  it("rejects code that names a language or its extension, and a pool of the wrong size", () => {
    expect(() => validateLanguageCandidate({ profile, candidate: stackCandidate(profile, snapshotId, "Python", 0, {
      excerpt: "def compute(value):\n    # Python makes this easy\n    return value * 2 + 1 + value * 3 + value * 4 + value * 5 + 99999",
    }) })).toThrow(LanguageRoundsError);
    expect(() => validateLanguageCandidate({ profile, candidate: stackCandidate(profile, snapshotId, "Rust", 0, {
      excerpt: "fn compute(value: i64) -> i64 {\n    // see compute.rs for the rest of the helpers in this module\n    value * 2\n}",
    }) })).toThrow(LanguageRoundsError);
    expect(() => generateLanguageRounds({ profile, candidates: pool().slice(0, 9) })).toThrow(LanguageRoundsError);
  });

  it("orders the pool by round identity and is deterministic", () => {
    const first = generateLanguageRounds({ profile, candidates: pool() });
    const second = generateLanguageRounds({ profile, candidates: [...pool()].reverse() });
    expect(second).toEqual(first);
    const ids = first.fixtures.map(({ roundId }) => roundId);
    expect(ids).toEqual([...ids].sort());
  });
});
