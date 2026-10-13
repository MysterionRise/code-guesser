import { readFile } from "node:fs/promises";

import { canonicalHash } from "./canonical";
import { crawlGitHubCommitSearch, GitHubSearchError } from "./github-search";
import { parseCrawlProfile, type CrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const PROFILE_URL = new URL("../profiles/local-real-rounds.v2.json", import.meta.url);

const loadProfile = async (): Promise<CrawlProfile> =>
  parseCrawlProfile(JSON.parse(await readFile(PROFILE_URL, "utf8")));

const commitItem = (ordinal: number): Record<string, unknown> => {
  const commit = ordinal.toString(16).padStart(40, "0");
  const repository = `example/project-${ordinal}`;
  return {
    sha: commit,
    url: `https://api.github.com/repos/${repository}/commits/${commit}`,
    html_url: `https://github.com/${repository}/commit/${commit}`,
    commit: { committer: { date: "2026-07-30T10:00:00Z" } },
    repository: {
      full_name: repository,
      url: `https://api.github.com/repos/${repository}`,
      html_url: `https://github.com/${repository}`,
    },
  };
};

const datedCommitItem = (
  date: string,
  ordinal = 1,
  repository = `example/project-${ordinal}`,
): Record<string, unknown> => ({
  ...commitItem(ordinal),
  commit: { committer: { date } },
  repository: {
    full_name: repository,
    url: `https://api.github.com/repos/${repository}`,
    html_url: `https://github.com/${repository}`,
  },
  url: `https://api.github.com/repos/${repository}/commits/${ordinal.toString(16).padStart(40, "0")}`,
  html_url: `https://github.com/${repository}/commit/${ordinal.toString(16).padStart(40, "0")}`,
});

const response = (
  totalCount: number,
  incompleteResults: unknown,
  items: readonly Record<string, unknown>[],
): Record<string, unknown> => ({
  total_count: totalCount,
  incomplete_results: incompleteResults,
  items,
});

const crawl = async (
  profile: CrawlProfile,
  pages: readonly Record<string, unknown>[],
): Promise<any> => {
  let pageIndex = 0;
  return crawlGitHubCommitSearch({
    profile,
    transport: { requestJson: async () => pages[pageIndex++] },
    retry: { execute: async (operation) => operation() },
  });
};

const crawlDates = async (
  dates: readonly string[],
  repositories?: readonly string[],
): Promise<{ profile: CrawlProfile; pool: any; rawResponse: Record<string, unknown> }> => {
  const profile = structuredClone(await loadProfile()) as any;
  profile.github.queries = [profile.github.queries[0]];
  profile.capacity.githubPages = 1;
  profile.capacity.githubResults = Math.max(1, dates.length);
  const rawResponse = response(dates.length, false, dates.map((date, index) =>
    datedCommitItem(date, index + 1, repositories?.[index])));
  return { profile, pool: await crawl(profile, [rawResponse]), rawResponse };
};

describe("GitHub search completeness classifications", () => {
  it("classifies an all-complete query and freezes the classification", async () => {
    const profile = await loadProfile();
    const rawResponse = response(0, false, []);

    const pool = await crawl(profile, profile.github.queries.map(() => rawResponse));

    expect(pool.queryClassifications).toEqual(profile.github.queries.map(({ id }) => ({
      queryId: id,
      completeness: "COMPLETE",
    })));
    expect(Object.isFrozen(pool.queryClassifications)).toBe(true);
    expect(pool.queryClassifications.every(Object.isFrozen)).toBe(true);
    expect(pool.acceptedResponseHashes).toEqual([canonicalHash(rawResponse)]);
  });

  it("rejects provider-incomplete pages because revision 12 authorizes no incomplete query tuple", async () => {
    const profile = await loadProfile();
    const incompleteResponse = response(0, true, []);

    await expect(crawl(profile, profile.github.queries.map(() => incompleteResponse))).rejects.toBeInstanceOf(GitHubSearchError);
  });

  it("rejects a mixed-page query because any incomplete page fails closed", async () => {
    const profile = await loadProfile();
    const firstPage = response(
      101,
      true,
      Array.from({ length: 100 }, (_, index) => commitItem(index + 1)),
    );
    const lastPage = response(101, false, [commitItem(101)]);
    const completeEmpty = response(0, false, []);

    await expect(crawl(profile, [firstPage, lastPage, ...profile.github.queries.slice(1).map(() => completeEmpty)]))
      .rejects.toBeInstanceOf(GitHubSearchError);
  });

  it("rejects provider-incomplete results when the authorized profile tuple set drifts", async () => {
    const profile = await loadProfile();
    const mutations: readonly [string, (profileValue: any) => void][] = [
      ["profile version", (value) => { value.profileVersion = "local-real-rounds.v2"; }],
      ["query count", (value) => { value.github.queries.pop(); }],
      ["identifier", (value) => { value.github.queries[0].id = "other-query"; }],
      ["query", (value) => { value.github.queries[0].query += " repo:example/project"; }],
      ["sort", (value) => { value.github.queries[0].sort = "author-date"; }],
      ["order", (value) => { value.github.queries[0].order = "asc"; }],
    ];

    for (const [name, mutate] of mutations) {
      const driftedProfile = structuredClone(profile) as any;
      mutate(driftedProfile);
      await expect(
        crawl(driftedProfile, [response(0, true, []), response(0, true, []), response(0, true, [])]),
        name,
      ).rejects.toBeInstanceOf(GitHubSearchError);
    }
  });

  it("rejects every non-boolean provider completeness flag", async () => {
    const profile = await loadProfile();
    const missingFlag = response(0, false, []);
    delete missingFlag.incomplete_results;
    await expect(
      crawl(profile, [missingFlag, missingFlag, missingFlag]),
      "missing flag",
    ).rejects.toBeInstanceOf(GitHubSearchError);

    for (const malformed of [null, 0, 1, "false", {}, []]) {
      const malformedResponse = response(0, malformed, []);
      await expect(
        crawl(profile, [malformedResponse, malformedResponse, malformedResponse]),
        JSON.stringify(malformed),
      ).rejects.toBeInstanceOf(GitHubSearchError);
    }
  });
});

describe("GitHub committer timestamps", () => {
  it("normalizes a valid numeric-offset timestamp", async () => {
    const { pool } = await crawlDates(["2026-07-30T10:00:00+01:30"]);

    expect(pool.candidates[0].committerDate).toBe("2026-07-30T08:30:00.000Z");
  });

  it("accepts exactly the four lexical forms and normalizes their instants", async () => {
    const cases = [
      ["2026-07-30T10:00:00Z", "2026-07-30T10:00:00.000Z"],
      ["2026-07-30T10:00:00.123Z", "2026-07-30T10:00:00.123Z"],
      ["2026-07-30T10:00:00+01:30", "2026-07-30T08:30:00.000Z"],
      ["2026-07-30T10:00:00-01:30", "2026-07-30T11:30:00.000Z"],
      ["2026-07-30T10:00:00.123+01:30", "2026-07-30T08:30:00.123Z"],
      ["2026-07-30T10:00:00.123-01:30", "2026-07-30T11:30:00.123Z"],
    ] as const;

    for (const [lexeme, normalized] of cases) {
      const { pool } = await crawlDates([lexeme]);
      expect(pool.candidates[0].committerDate, lexeme).toBe(normalized);
    }
  });

  it("accepts calendar, clock, year, and offset boundaries", async () => {
    const accepted = [
      "0000-01-01T00:00:00Z", "9999-12-31T23:59:59.999Z",
      "2000-02-29T12:00:00Z", "2024-02-29T12:00:00Z",
      "2026-01-31T00:00:00Z", "2026-12-31T23:59:59Z",
      "2026-07-30T10:00:00+00:00", "2026-07-30T10:00:00+13:59",
      "2026-07-30T10:00:00+14:00", "2026-07-30T10:00:00-13:59",
      "2026-07-30T10:00:00-14:00",
    ];

    for (const lexeme of accepted) {
      const { pool } = await crawlDates([lexeme]);
      expect(pool.candidates[0].committerDate, lexeme)
        .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    }
  });

  it("rejects every non-authorized lexical or semantic boundary", async () => {
    const rejected = [
      "10000-01-01T00:00:00Z", "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z",
      "2026-01-00T00:00:00Z", "2026-01-32T00:00:00Z", "1900-02-29T00:00:00Z",
      "2023-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-01-01T24:00:00Z",
      "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00.0Z",
      "2026-01-01T00:00:00.00Z", "2026-01-01T00:00:00.0000Z",
      "2026-01-01t00:00:00Z", "2026-01-01T00:00:00z", " 2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z ", "2026-01-01 T00:00:00Z", "2026-01-01T00:00:00",
      "2026-01-01", "Infinity", "2026/01/01T00:00:00Z", "2026-01-01T000000Z",
      "2026-01-01T00:00:00,000Z", "2026-01-01T00:00:00+0000",
      "2026-01-01T00:00:00+14:01",
      "2026-01-01T00:00:00-14:01", "2026-01-01T00:00:00+15:00",
      "2026-01-01T00:00:00+00:60", "2026-01-01T00:00:00-00:00",
      "0000-01-01T00:00:00+00:01", "9999-12-31T23:59:59-00:01",
    ];

    for (const lexeme of rejected) {
      await expect(crawlDates([lexeme]), lexeme).rejects.toBeInstanceOf(GitHubSearchError);
    }
  });

  it("preserves raw lexemes in distinct response and crawl-snapshot identities", async () => {
    const first = await crawlDates(["2026-07-30T10:00:00+01:00"]);
    const second = await crawlDates(["2026-07-30T09:00:00Z"]);
    const profileHash = canonicalHash(first.profile);
    const snapshot = (hashes: readonly string[]): string => canonicalHash({
      profileHash,
      acceptedResponseHashes: hashes,
    });

    expect(first.pool.candidates[0].committerDate).toBe(second.pool.candidates[0].committerDate);
    expect(((first.rawResponse.items as any[])[0].commit.committer.date))
      .toBe("2026-07-30T10:00:00+01:00");
    expect(((second.rawResponse.items as any[])[0].commit.committer.date))
      .toBe("2026-07-30T09:00:00Z");
    expect(first.pool.acceptedResponseHashes).toEqual([canonicalHash(first.rawResponse)]);
    expect(second.pool.acceptedResponseHashes).toEqual([canonicalHash(second.rawResponse)]);
    expect(first.pool.acceptedResponseHashes).not.toEqual(second.pool.acceptedResponseHashes);
    expect(snapshot(first.pool.acceptedResponseHashes)).not.toBe(snapshot(second.pool.acceptedResponseHashes));
  });

  it("uses existing repository and commit tie-breakers for equal normalized instants", async () => {
    const { pool } = await crawlDates(
      ["2026-07-30T10:00:00+01:00", "2026-07-30T09:00:00.000Z"],
      ["example/zeta", "example/alpha"],
    );
    const sameRepository = await crawlDates(
      ["2026-07-30T10:00:00+01:00", "2026-07-30T09:00:00.000Z"],
      ["example/project", "example/project"],
    );

    expect(pool.candidates.map((candidate: any) => candidate.repository))
      .toEqual(["example/alpha", "example/zeta"]);
    expect(new Set(pool.candidates.map((candidate: any) => candidate.committerDate)).size).toBe(1);
    expect(sameRepository.pool.candidates.map((candidate: any) => candidate.commit))
      .toEqual([1, 2].map((ordinal) => ordinal.toString(16).padStart(40, "0")));
  });
});
