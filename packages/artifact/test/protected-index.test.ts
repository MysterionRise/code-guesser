import { describe, expect, it } from "vitest";

import { containsProtected, protectedIndex } from "../src/index";

/** A small deterministic generator, so a failing case repeats exactly. */
const seededRandom = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

/**
 * Few pieces, so needles often meet the haystack: words and word characters, the characters a match stands between,
 * regular-expression syntax, JSON escapes, letters outside ASCII, an astral character, and a lone surrogate.
 */
const PIECES = [
  "foo", "Foo", "bar", "foo_bar", "fooBar", "x1", "42", "_", "a", "b", " ", "\n", "/", "-", ".", ":", "@", "\"", "\\n",
  "(", ")", "[", "]", "*", "+", "?", "$", "^", "|", "\\", "é", "ß", "日本", "😀", "\ud83d",
];

describe("the containment index (#166)", () => {
  it("matches a protected value only as a whole word, as the scan does", () => {
    const cases: readonly (readonly [string, string, boolean])[] = [
      ["foo bar", "foo", true], ["foobar", "foo", false], ["foo_bar", "foo", false], ["foo-bar", "foo", true],
      ["x foo-bar", "o-b", false], ["a-b", "-", false], ["a - b", "-", true], ["foo", "", false], ["", "", true],
      ["owner/repo.git", "owner/repo", true], ["owner/repository", "owner/repo", false], ["é foo é", "foo", true],
      ["\"src/main.py\"", "src/main.py", true], ["日本foo", "foo", true], ["😀foo😀", "😀foo", true],
    ];
    for (const [haystack, needle, expected] of cases) {
      expect(containsProtected(haystack, needle), `${haystack} ${needle}`).toBe(expected);
      expect(protectedIndex(haystack)(needle), `${haystack} ${needle}`).toBe(expected);
    }
  });

  it("gives the scan's answer for random haystacks and needles", () => {
    const random = seededRandom(166);
    const pick = <Value>(values: readonly Value[]): Value => values[Math.floor(random() * values.length)]!;
    const pieces = (most: number): string => Array.from({ length: Math.floor(random() * (most + 1)) }, () => pick(PIECES)).join("");
    let matched = 0;
    let indexed = 0;
    for (let round = 0; round < 400; round += 1) {
      const haystack = pieces(40);
      const shows = protectedIndex(haystack);
      const words = new Set(haystack.match(/[A-Za-z0-9_]+/gu) ?? []);
      const needles = [
        "", ...PIECES,
        // Cuts of the haystack, which often split a word, and needles built from the pieces, which often are not in it.
        ...Array.from({ length: 30 }, () => {
          const start = Math.floor(random() * (haystack.length + 1));
          return haystack.slice(start, start + Math.floor(random() * 12));
        }),
        ...Array.from({ length: 20 }, () => pieces(4)),
      ];
      for (const needle of needles) {
        const scanned = containsProtected(haystack, needle);
        expect(shows(needle), JSON.stringify({ haystack, needle })).toBe(scanned);
        if (scanned) matched += 1;
        if ((needle.match(/[A-Za-z0-9_]+/gu) ?? []).some((word) => !words.has(word))) indexed += 1;
      }
    }
    // Both answers come up often, and the index settles many needles without a scan.
    expect(matched).toBeGreaterThan(1_000);
    expect(indexed).toBeGreaterThan(1_000);
  });
});
