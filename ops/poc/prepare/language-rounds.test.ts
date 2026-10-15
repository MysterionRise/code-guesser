import { generateLanguageRounds, LanguageRoundsError, validateLanguageCandidate } from "./language-rounds";
import { LANGUAGE_PAIRS } from "../../../packages/artifact/src/index";
import { MARKERS, tellsApart } from "./language-markers";
import { STACK_LANGUAGES } from "./profile";
import { deckCandidates, loadDeckProfile, sha256, snapshotIdFor, stackCandidate } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadDeckProfile();
const snapshotId = snapshotIdFor(profile);
const pool = () => deckCandidates(profile, snapshotId).language;

const pairOf = (label: string) => LANGUAGE_PAIRS.find((pair) => (pair as readonly string[]).includes(label))!;

describe("language rounds", () => {
  it("offers two look-alike pairs per round: the answer's own pair and one more", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    expect(fixtures).toHaveLength(24);
    for (const fixture of fixtures) {
      const labels = fixture.candidates.map(({ label }) => label);
      expect(labels).toHaveLength(4);
      expect(labels.every((label) => (STACK_LANGUAGES as readonly string[]).includes(label))).toBe(true);
      expect(labels).toEqual(expect.arrayContaining([...pairOf(String(fixture.source.configuration))]));
      // Every option's look-alike is an option too, so a missing sibling never singles one out.
      expect(labels.every((label) => pairOf(label).every((member) => labels.includes(member)))).toBe(true);
      expect(fixture.panes).toEqual([{ label: null, text: expect.any(String) }]);
      expect(fixture.candidates.every(({ detail }) => detail === null)).toBe(true);
    }
  });

  it("shows an option set in at most two rounds, whose answers sit in different pairs (#81)", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    const setKey = (fixture: (typeof fixtures)[number]) => fixture.candidates.map(({ label }) => label).sort().join("|");
    const answers = new Map<string, string[]>();
    for (const fixture of fixtures) answers.set(setKey(fixture), [...(answers.get(setKey(fixture)) ?? []), String(fixture.source.configuration)]);
    for (const answered of answers.values()) {
      expect(answered.length).toBeLessThanOrEqual(2);
      if (answered.length === 2) expect(pairOf(answered[0]!)).not.toEqual(pairOf(answered[1]!));
    }
    // A language's two rounds offer different second pairs, and every pair is the second pair in four rounds.
    for (const language of STACK_LANGUAGES) {
      expect(new Set(fixtures.filter(({ source }) => source.configuration === language).map(setKey)).size).toBe(2);
    }
    for (const pair of LANGUAGE_PAIRS) {
      const second = fixtures.filter((fixture) => !(pair as readonly string[]).includes(String(fixture.source.configuration))
        && fixture.candidates.some(({ label }) => (pair as readonly string[]).includes(label)));
      expect(second).toHaveLength(4);
    }
  });

  it("shows every language in exactly eight rounds, so how often an option appears says nothing", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    const appearances = new Map<string, number>();
    for (const fixture of fixtures) for (const { label } of fixture.candidates) appearances.set(label, (appearances.get(label) ?? 0) + 1);
    expect([...appearances.values()]).toEqual(Array(12).fill(8));
  });

  it("keeps only code that tells its language apart from the look-alike", () => {
    const candidate = (language: (typeof STACK_LANGUAGES)[number], excerpt: string) =>
      stackCandidate(profile, snapshotId, language, 0, { excerpt, excerptHash: sha256(excerpt) });
    // Plain code with no telling syntax could be either language of its pair.
    expect(() => validateLanguageCandidate({ profile, candidate: candidate("JavaScript",
      "const total = values.reduce((sum, value) => sum + value, 0);\nconst average = total / values.length;\nconsole.log(average, total, values.length);") }))
      .toThrow("LANGUAGE_PAIR_AMBIGUOUS");
    // C code may not show C++ syntax; C++ code may show C idioms beside its own.
    expect(() => validateLanguageCandidate({ profile, candidate: candidate("C",
      "static int compute(int value)\n{\n    std::size_t total = value * 2;\n    printf(\"%d\\n\", total);\n    total = total + value * 3;\n    return total;\n}") }))
      .toThrow("LANGUAGE_PAIR_AMBIGUOUS");
    expect(tellsApart("int Ledger::add(int amount) {\n    printf(\"%d\", amount);\n    return NULL;\n}", "C++")).toBe(true);
    expect(tellsApart("export const total = (value: number) => value * 2;\nvar legacy = require(\"x\");", "TypeScript")).toBe(true);
    expect(tellsApart("const total = require(\"x\");\ninterface Shape { size: number }", "JavaScript")).toBe(false);
    // Symmetric pairs: the other language's syntax makes the code ambiguous.
    expect(tellsApart("fun compute(value: Int): Int {\n    val total = value * 2\n    guard total > 0 else { return 0 }\n}", "Kotlin")).toBe(false);
    expect(tellsApart("def compute(value)\n  return nil if value.nil?\nend", "Python")).toBe(false);
    for (const language of STACK_LANGUAGES) expect(MARKERS[language].length).toBeGreaterThan(0);
  });

  it("draws both hints from the excerpt, naming no language", () => {
    const { fixtures } = generateLanguageRounds({ profile, candidates: pool() });
    const go = fixtures.find(({ source }) => source.configuration === "Go" && String(source.path).endsWith("compute.go"))!;
    expect(go.clues).toEqual(["Blocks are wrapped in braces.", "Look for `:=` in the code."]);
    const python = fixtures.find(({ source }) => source.configuration === "Python" && String(source.path).endsWith("compute.py"))!;
    expect(python.clues).toEqual(["Blocks open with a colon and are set by indentation.", "Look for `elif` in the code."]);
    const ruby = fixtures.find(({ source }) => source.configuration === "Ruby" && String(source.path).endsWith("compute.rb"))!;
    expect(ruby.clues[0]).toBe("Blocks close with a line that says end.");
    const csharp = fixtures.find(({ source }) => source.configuration === "C#" && String(source.path).endsWith("Ledger.cs"))!;
    expect(csharp.clues[1]).toBe("Look for `=>` in the code.");
    expect(csharp.helpfulSignals).toEqual(["`=>` is typical C#, not Java."]);
    expect(csharp.misleadingSignals).toEqual(["Java looks much the same: both put methods in classes behind the same access modifiers."]);
    // The C++ class's `public:` ends in a colon before an indented line, yet its blocks are braces.
    const cpp = fixtures.find(({ source }) => source.configuration === "C++" && String(source.path).endsWith("ledger.cpp"))!;
    expect(cpp.clues[0]).toBe("Blocks are wrapped in braces.");
    const c = fixtures.find(({ source }) => source.configuration === "C" && String(source.path).endsWith("ledger.c"))!;
    expect(c.helpfulSignals).toEqual(["`malloc(` is typical C, and nothing here needs C++."]);
    for (const fixture of fixtures) {
      expect(fixture.clues.join(" ")).not.toMatch(/\b(?:Python|Ruby|TypeScript|JavaScript|Go|Rust|Java|Kotlin|Swift)\b|(?:^|[^\w+#])C(?:\+\+|#)?(?![\w+#])/u);
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
    expect(() => generateLanguageRounds({ profile, candidates: pool().slice(0, 23) })).toThrow(LanguageRoundsError);
  });

  it("orders the pool by round identity and is deterministic", () => {
    const first = generateLanguageRounds({ profile, candidates: pool() });
    const second = generateLanguageRounds({ profile, candidates: [...pool()].reverse() });
    expect(second).toEqual(first);
    const ids = first.fixtures.map(({ roundId }) => roundId);
    expect(ids).toEqual([...ids].sort());
  });
});
