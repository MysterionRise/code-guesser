import { readFile } from "node:fs/promises";

import {
  CrawlProfileError,
  SIGNED_CAPACITY_CEILINGS,
  parseCrawlProfile,
} from "./profile";

const profilePath = new URL("../profiles/local-real-rounds.v1.json", import.meta.url);
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const validProfile = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;

describe("local crawl profile", () => {
  it("loads the immutable project profile with the exact dataset pin", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.stack.release).toBe("v2.2.0");
    expect(profile.stack.revision).toBe(
      "e565caa3a78c2423bd374333a472b049eb090e47",
    );
    expect(profile.stack.configurations.map(({ language }) => language)).toEqual([
      "Python",
      "TypeScript",
    ]);
    expect(Object.isFrozen(profile.stack.configurations)).toBe(true);
  });

  it("binds the exact bounded GitHub discovery queries", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.github.queries).toEqual([
      {
        id: "microsoft-generated-trailer",
        query: "\"Generated-by: Copilot\" org:microsoft committer-date:2026-07-31 merge:false is:public",
        sort: "committer-date",
        order: "desc",
      },
      {
        id: "github-generated-trailer",
        query: "\"Generated-by: Copilot\" org:github committer-date:2026-01-01..2026-07-31 merge:false is:public",
        sort: "committer-date",
        order: "desc",
      },
      {
        id: "facebook-ordinary-change",
        query: "refactor org:facebook committer-date:2026-07-01..2026-07-31 merge:false is:public",
        sort: "committer-date",
        order: "desc",
      },
    ]);
  });

  it("rejects a truly omitted required key and unknown fields at any depth", async () => {
    const base = await validProfile();
    const omitted = structuredClone(base);
    delete omitted.markers;
    const github = base.github as Record<string, unknown>;
    const cases: unknown[] = [
      { ...base, surprise: true },
      omitted,
      { ...base, github: { ...github, surprise: true } },
      {
        ...base,
        github: {
          ...github,
          queries: [
            ...((github.queries as unknown[]).slice(0, 1)),
            { ...((github.queries as Record<string, unknown>[])[1]), surprise: true },
          ],
        },
      },
    ];

    for (const candidate of cases) {
      expect(() => parseCrawlProfile(candidate)).toThrow(CrawlProfileError);
    }
  });

  it("rejects URL and credential material even inside otherwise allowed values", async () => {
    const base = await validProfile();
    const github = base.github as Record<string, unknown>;
    const queries = github.queries as Record<string, unknown>[];
    const cases: unknown[] = [
      { ...base, profileVersion: "local-real-rounds.v1 https://example.com" },
      {
        ...base,
        github: {
          ...github,
          queries: [{ ...queries[0], query: "refactor at https://example.com/a" }],
        },
      },
      { ...base, markers: ["authorization=Bearer abc123"] },
      { ...base, licenses: ["token: secret-value"] },
      {
        ...base,
        templates: {
          ...(base.templates as Record<string, unknown>),
          provenancePrompt: "cookie=session-value",
        },
      },
    ];

    for (const candidate of cases) {
      expect(() => parseCrawlProfile(candidate)).toThrow(CrawlProfileError);
    }
  });

  it("accepts the immutable revision and literal marker strings without false positives", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.stack.revision).toBe("e565caa3a78c2423bd374333a472b049eb090e47");
    expect(profile.markers).toEqual([
      "Co-authored-by: GitHub Copilot",
      "Co-authored-by: Copilot",
      "Co-authored-by: Copilot App",
      "Generated-by: Copilot",
    ]);
  });

  it("accepts each signed capacity exactly and rejects its first over-ceiling value", async () => {
    const base = await validProfile();

    for (const [key, ceiling] of Object.entries(SIGNED_CAPACITY_CEILINGS)) {
      const exact = {
        ...base,
        capacity: { ...(base.capacity as Record<string, number>), [key]: ceiling },
      };
      expect(parseCrawlProfile(exact).capacity[key as keyof typeof SIGNED_CAPACITY_CEILINGS])
        .toBe(ceiling);

      const over = {
        ...base,
        capacity: { ...(base.capacity as Record<string, number>), [key]: ceiling + 1 },
      };
      expect(() => parseCrawlProfile(over)).toThrow(CrawlProfileError);
    }
  });

  it("returns a recursively immutable profile including every nested array and object", async () => {
    const profile = parseCrawlProfile(await validProfile());
    const objects: object[] = [];
    const visit = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      objects.push(value);
      for (const nested of Object.values(value)) visit(nested);
    };
    visit(profile);

    expect(objects.length).toBeGreaterThan(10);
    expect(objects.every(Object.isFrozen)).toBe(true);
  });

  it("owns deterministic round templates, source ordering, and cross-source identity fields", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.templates.provenance).toEqual({
      prompt: "Does this commit record contain a configured marker?",
      recordedCandidate: "Configured marker recorded",
      unrecordedCandidate: "Configured marker not recorded in this commit",
      clues: [
        "Inspect the pinned commit record for exact configured marker text.",
        "Treat code style as unrelated to this record-only question.",
      ],
      recordedEvidence: "The pinned commit message contains a configured literal marker.",
      unrecordedEvidence: "The pinned commit message contains no configured literal marker.",
      explanation: "This result describes only configured literal marker presence in the pinned commit record.",
    });
    expect(profile.templates.language).toEqual({
      prompt: "Which programming language is this excerpt?",
      clues: [
        "Inspect the syntax without relying on repository identity.",
        "The pinned file extension maps to {language} in this experiment.",
      ],
      evidence: "The pinned file extension and detected language agree on {language}.",
      explanation: "The configured extension, Stack detected language, and revalidated GitHub record agree on {language}.",
    });
    expect(Object.isFrozen(profile.templates.provenance.clues)).toBe(true);
    expect(Object.isFrozen(profile.templates.language.clues)).toBe(true);
    expect(profile.ordering.github).toEqual([
      "queryIndex",
      "committerDateDescending",
      "repository",
      "commit",
      "path",
      "blob",
    ]);
    expect(profile.ordering.stack).toEqual([
      "configurationIndex",
      "stableRowId",
      "repository",
      "revision",
      "path",
      "blob",
    ]);
    expect(profile.deduplication).toEqual([
      "repository",
      "commit",
      "path",
      "blob",
      "rawContentHash",
      "excerptHash",
    ]);
  });
});
