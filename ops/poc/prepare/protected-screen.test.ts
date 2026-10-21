import { AUTHORSHIP_CLAIM, protectedIndex } from "../../../packages/artifact/src/index";
import { PROTECTED_SOURCE_KEYS } from "./compose";
import type { CrawlProfile } from "./profile";
import { protectedScreen, revealsProtected, safeDescription } from "./selection";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

/** The checks as they were before the index (#166): a fresh pattern for each value, over the whole public text. */
const scanned = (publicText: string, value: string): boolean => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "u").test(publicText);
};
const view = (value: unknown): any => typeof value === "object" && value !== null ? value : {};
const sourceOf = (value: unknown): any => view(value).source ?? view(value);
const excerptOf = (candidate: unknown): string => {
  const { lineage, excerpt } = view(candidate);
  if (!lineage) return String(excerpt ?? "");
  const subject = String(lineage.commitMessage ?? "").split(/\r?\n/u)[0] ?? "";
  return [lineage.beforeExcerpt, lineage.afterExcerpt ?? lineage.excerpt, subject].map((part) => String(part ?? "")).join("\n");
};
const scannedReveals = (profile: CrawlProfile, candidate: unknown, selected: readonly unknown[]): boolean => {
  const all = [...selected, candidate];
  const publicText = `${JSON.stringify(profile.templates)}\n${all.map(excerptOf).join("\n")}`;
  return all.some((item) => {
    const source = sourceOf(item);
    return PROTECTED_SOURCE_KEYS.some((key) => {
      const value = source[key];
      return typeof value === "string" && value.length > 0
        && !(key === "rawContentHash" && value === source.excerptHash) && scanned(publicText, value);
    });
  });
};
const scannedDescription = (description: string | null, protectedValues: readonly string[]): string | null =>
  description !== null && (protectedValues.some((value) => scanned(description, value)) || AUTHORSHIP_CLAIM.test(description))
    ? null : description;

/** A small deterministic generator, so a failing case repeats exactly. */
const seededRandom = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

/**
 * Few pieces, so values often meet the public text: words and word characters, the characters a match stands
 * between, line breaks (which join the public text's parts), regular-expression syntax, JSON escapes, letters outside
 * ASCII, an astral character, and a lone surrogate.
 */
const PIECES = [
  "foo", "Foo", "bar", "foo_bar", "fooBar", "x1", "42", "_", "a", " ", "\n", "\r\n", "/", "-", ".", ":", "@", "\"", "\\n",
  "(", ")", "[", "]", "*", "+", "?", "$", "^", "|", "\\", "é", "ß", "日本", "😀", "\ud83d",
];

const generator = (seed: number) => {
  const random = seededRandom(seed);
  const pick = <Value>(values: readonly Value[]): Value => values[Math.floor(random() * values.length)]!;
  const pieces = (least: number, most: number): string =>
    Array.from({ length: least + Math.floor(random() * (most - least + 1)) }, () => pick(PIECES)).join("");
  /**
   * One selection's world: a few phrases its excerpts and values share, so a value often shows in the selection's
   * text, in a candidate's excerpt, or across the line break between them, or with no word run.
   */
  const world = () => {
    const phrases = Array.from({ length: 6 }, () => pieces(1, 4));
    const excerpt = (): string => Array.from({ length: Math.floor(random() * 4) }, () => pick(phrases))
      .join(pick([" ", "\n", "", "/", "日本"]));
    /** A value of a protected key: often absent or not text, often a phrase or two phrases across a line break. */
    const value = (): unknown => {
      const roll = random();
      if (roll < 0.9) return undefined;
      if (roll < 0.91) return pick([42, null, ""]);
      if (roll < 0.95) return pick(phrases);
      if (roll < 0.98) return `${pick(phrases)}\n${pick(phrases)}`;
      return pieces(2, 6);
    };
    /** A Stack file, a curated pane, or an admitted commit with its lineage and provenance record. */
    const candidate = (): unknown => {
      const shown = excerpt();
      const source: Record<string, unknown> = Object.fromEntries(PROTECTED_SOURCE_KEYS.flatMap((key) => {
        const chosen = value();
        return chosen === undefined ? [] : [[key, chosen]];
      }));
      if (random() < 0.2) source.rawContentHash = source.excerptHash = pick(phrases);
      if (random() < 0.7) return { ...source, excerpt: shown };
      const lineage = { beforeExcerpt: excerpt(), afterExcerpt: random() < 0.8 ? shown : undefined, excerpt: shown,
        commitMessage: `${excerpt()}\n${excerpt()}` };
      return { repository: source.repository, lineage, source };
    };
    const profile = { templates: { prompt: excerpt(), evidence: pieces(0, 4) } } as unknown as CrawlProfile;
    return { profile, candidate };
  };
  return { random, pieces, world };
};

/** The scan's answer counting only the values `keep` keeps, to see which values decide it. */
const revealsKept = (profile: CrawlProfile, candidate: unknown, selected: readonly unknown[], keep: (value: string) => boolean): boolean => {
  const only = (item: unknown): unknown => ({ excerpt: excerptOf(item), ...Object.fromEntries(PROTECTED_SOURCE_KEYS
    .flatMap((key) => typeof sourceOf(item)[key] === "string" && keep(sourceOf(item)[key]) ? [[key, sourceOf(item)[key]]] : [])),
    ...(sourceOf(item).excerptHash === undefined ? {} : { excerptHash: sourceOf(item).excerptHash }) });
  return scannedReveals(profile, only(candidate), selected.map(only));
};

describe("the preparer's indexed containment checks (#166)", () => {
  it("screens each candidate against a selection as the whole-text scan did", () => {
    const { random, world } = generator(166);
    const outcomes = { revealed: 0, hidden: 0, bySelection: 0, byExcerpt: 0, acrossLineBreak: 0, withoutWordRun: 0 };
    for (let round = 0; round < 600; round += 1) {
      const { profile, candidate } = world();
      const selected = Array.from({ length: Math.floor(random() * 6) }, candidate);
      const screen = protectedScreen(profile, selected);
      const bySelection = selected.length > 0 && scannedReveals(profile, selected.at(-1), selected.slice(0, -1));
      if (bySelection) outcomes.bySelection += 1;
      for (const next of Array.from({ length: 1 + Math.floor(random() * 8) }, candidate)) {
        const expected = scannedReveals(profile, next, selected);
        expect(screen(next), JSON.stringify({ profile, selected, next })).toBe(expected);
        expect(revealsProtected(profile, next, selected)).toBe(expected);
        outcomes[expected ? "revealed" : "hidden"] += 1;
        if (!expected || bySelection) continue;
        // What decided it: a selected value in the candidate's excerpt, a value across the line break, one with no word run.
        if (scannedReveals(profile, { excerpt: excerptOf(next) }, selected)) outcomes.byExcerpt += 1;
        if (!revealsKept(profile, next, selected, (value) => !value.includes("\n"))) outcomes.acrossLineBreak += 1;
        if (!revealsKept(profile, next, selected, (value) => /[A-Za-z0-9_]/u.test(value))) outcomes.withoutWordRun += 1;
      }
    }
    // Both answers come up often, and so does each way a value can decide one.
    expect(outcomes.revealed).toBeGreaterThan(500);
    expect(outcomes.hidden).toBeGreaterThan(500);
    expect(outcomes.bySelection).toBeGreaterThan(50);
    expect(outcomes.byExcerpt).toBeGreaterThan(100);
    expect(outcomes.acrossLineBreak).toBeGreaterThan(20);
    expect(outcomes.withoutWordRun).toBeGreaterThan(20);
  });

  it("answers for a value with a line break, a selection that already reveals, and a value with no word run", () => {
    const crawl = { templates: { prompt: "Which one?" } } as unknown as CrawlProfile;
    const spanning = { excerpt: "alpha", authorName: "alpha\nbeta" };
    expect(protectedScreen(crawl, [spanning])({ excerpt: "beta gamma" })).toBe(true);
    expect(protectedScreen(crawl, [spanning])({ excerpt: "gamma beta" })).toBe(false);
    const revealing = { excerpt: "by Ada Lovelace", authorName: "Ada Lovelace" };
    expect(protectedScreen(crawl, [revealing])({ excerpt: "" })).toBe(true);
    const wordless = { excerpt: "x", licenseName: "日本" };
    expect(protectedScreen(crawl, [wordless])({ excerpt: "(日本)" })).toBe(true);
    expect(protectedScreen(crawl, [wordless])({ excerpt: "x日本" })).toBe(false);
    // A whole-file excerpt's raw content hash is its excerpt hash, a hash of public text.
    expect(protectedScreen(crawl, [])({ excerpt: "f00d", rawContentHash: "f00d", excerptHash: "f00d" })).toBe(false);
    expect(protectedScreen(crawl, [])({ excerpt: "f00d", rawContentHash: "f00d", excerptHash: "beef" })).toBe(true);
  });

  it("indexes composition's public text and a description as the scan did", () => {
    const { random, pieces } = generator(167);
    const outcomes = { shown: 0, hidden: 0, kept: 0, dropped: 0 };
    for (let round = 0; round < 400; round += 1) {
      const publicText = pieces(0, 40);
      const shows = protectedIndex(publicText);
      const values = [
        "", ...PIECES, ...Array.from({ length: 30 }, () => {
          const start = Math.floor(random() * (publicText.length + 1));
          return publicText.slice(start, start + Math.floor(random() * 12));
        }),
        ...Array.from({ length: 20 }, () => pieces(1, 4)),
      ];
      for (const value of values) {
        const expected = scanned(publicText, value);
        expect(shows(value), JSON.stringify({ publicText, value })).toBe(expected);
        outcomes[expected ? "shown" : "hidden"] += 1;
      }
      const description = random() < 0.1 ? null : publicText;
      const protectedValues = values.filter(() => random() < 0.05);
      const expected = scannedDescription(description, protectedValues);
      expect(safeDescription(description, protectedValues)).toBe(expected);
      if (description !== null) outcomes[expected === null ? "dropped" : "kept"] += 1;
    }
    expect(outcomes.shown).toBeGreaterThan(1_000);
    expect(outcomes.hidden).toBeGreaterThan(1_000);
    expect(outcomes.kept).toBeGreaterThan(50);
    expect(outcomes.dropped).toBeGreaterThan(50);
  });
});
