import { generateLanguageRounds, languageCandidateId, validateLanguageCandidate } from "./language-rounds";
import { mentionsExtension, mentionsLabel } from "./profile";
import { loadV2Profile, sha256, snapshotIdFor, stackCandidate } from "./testdata/v2-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const profile = loadV2Profile();
const snapshotId = snapshotIdFor(profile);
const LANGUAGES = ["Python", "TypeScript", "Go", "Rust", "Ruby"] as const;
const candidates = () => LANGUAGES.map((language) => stackCandidate(profile, snapshotId, language));
const withExcerpt = (language: typeof LANGUAGES[number], excerpt: string) =>
  stackCandidate(profile, snapshotId, language, { excerpt, excerptHash: sha256(excerpt) });

describe("FR-025 language deck generation", () => {
  it("produces five rounds in five distinct languages with four candidates each", () => {
    const deck = generateLanguageRounds({ profile, candidates: candidates() });

    expect(deck.fixtures).toHaveLength(5);
    expect(new Set(deck.fixtures.map(({ source }) => source.configuration))).toEqual(new Set(LANGUAGES));
    for (const fixture of deck.fixtures) {
      const language = String(fixture.source.configuration);
      const template = profile.templates.language.languages.find((entry) => entry.language === language)!;
      expect(fixture.prompt).toBe("Which programming language is this?");
      expect(fixture.candidates.map(({ label }) => label).sort()).toEqual([language, ...template.distractors].sort());
      expect(fixture.correctCandidateId).toBe(languageCandidateId(language));
      expect(fixture.clues).toEqual(template.clues);
      expect(fixture.evidence).toBe(`The file extension, The Stack v2's detected language, and the GitHub record agree on ${language}.`);
      for (const text of [fixture.excerpt, ...fixture.clues, fixture.prompt]) {
        for (const { label } of fixture.candidates) expect(mentionsLabel(text, label)).toBe(false);
      }
      const extensions = profile.stack.configurations.find((entry) => entry.language === language)!.extensions;
      expect(extensions.some((extension) => mentionsExtension(fixture.excerpt, extension))).toBe(false);
    }
  });

  it("does not put the answer in a fixed position or follow the configuration order", () => {
    const deck = generateLanguageRounds({ profile, candidates: candidates() });
    const positions = deck.fixtures.map(({ candidates: options, correctCandidateId }) =>
      options.findIndex(({ id }) => id === correctCandidateId));
    expect(new Set(positions).size).toBeGreaterThan(1);
    expect(deck.fixtures.map(({ roundId }) => roundId)).toEqual([...deck.fixtures.map(({ roundId }) => roundId)].sort());
  });

  it("rejects excerpts that name a candidate language or the file extension", () => {
    for (const candidate of [
      withExcerpt("Python", "# Python helper for totals\ndef compute(value):\n    return value * 2 + 1000"),
      withExcerpt("Go", "// Ported from Rust\nfunc compute(value int) int {\n\treturn value * 2 + 1000\n}"),
      withExcerpt("Ruby", "require_relative 'helper.rb'\ndef compute(value)\n  value * 2 + 1000\nend"),
      withExcerpt("TypeScript", "// Unlike JavaScript, typed\nexport const compute = (value: number) => value * 2 + 1000;"),
    ]) {
      expect(() => validateLanguageCandidate({ profile, candidate })).toThrow("LANGUAGE_ROUNDS_REJECTED");
    }
    const keyword = withExcerpt("Go", "func compute(value int) int {\n\tgo report(value)\n\treturn value * 2 + 1000\n}");
    expect(() => validateLanguageCandidate({ profile, candidate: keyword })).not.toThrow();
  });

  it("rejects mismatched extensions, wrong source fields, over-long windows, and duplicate languages", () => {
    const longExcerpt = Array.from({ length: 21 }, (_, index) => `value_${index} = compute(${index}) + 1000`).join("\n");
    for (const candidate of [
      stackCandidate(profile, snapshotId, "Go", { path: "cmd/compute.rs", stackPath: "cmd/compute.rs", blobUrl: "x" }),
      stackCandidate(profile, snapshotId, "Rust", { detectedLanguage: "Go" }),
      stackCandidate(profile, snapshotId, "Ruby", { generated: true }),
      stackCandidate(profile, snapshotId, "Python", { licenseSpdx: "GPL-3.0", detectedLicenses: ["GPL-3.0"] }),
      withExcerpt("Python", longExcerpt),
    ]) {
      expect(() => validateLanguageCandidate({ profile, candidate })).toThrow("LANGUAGE_ROUNDS_REJECTED");
    }
    const duplicate = candidates();
    duplicate[4] = stackCandidate(profile, snapshotId, "Python", { repository: "stackorg/other", stackRepository: "stackorg/other" });
    expect(() => generateLanguageRounds({ profile, candidates: duplicate })).toThrow("LANGUAGE_ROUNDS_REJECTED");
    expect(() => generateLanguageRounds({ profile, candidates: candidates().slice(0, 4) })).toThrow("LANGUAGE_ROUNDS_REJECTED");
  });

  it("is byte-stable for the same candidates in any order", () => {
    const first = generateLanguageRounds({ profile, candidates: candidates() });
    const second = generateLanguageRounds({ profile, candidates: candidates().reverse() });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
