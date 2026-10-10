import { readFile } from "node:fs/promises";

import { canonicalHash } from "./canonical";
import { readFileSync } from "node:fs";
import { parseCrawlProfile, type CrawlProfile } from "./profile";
import { createRetryController } from "./retry";
import { createBoundedTransport } from "./transport";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const sourceModulePath: string = "./github-search";
const searchModule = await import(sourceModulePath).catch(() => ({})) as Record<string, unknown>;
const crawlGitHubCommitSearch = typeof searchModule.crawlGitHubCommitSearch === "function"
  ? searchModule.crawlGitHubCommitSearch as (...args: any[]) => Promise<any>
  : async (): Promise<never> => { throw new Error("GITHUB_SEARCH_NOT_IMPLEMENTED"); };

const profilePath = new URL("../profiles/local-real-rounds.v2.json", import.meta.url);
const shaFor = (value: number): string => value.toString(16).padStart(40, "0");
const searchItem = (
  commit: string,
  repository = "example/project",
  committerDate = "2026-07-30T10:00:00Z",
): Record<string, unknown> => ({
  sha: commit,
  url: `https://api.github.com/repos/${repository}/commits/${commit}`,
  html_url: `https://github.com/${repository}/commit/${commit}`,
  commit: { committer: { date: committerDate } },
  repository: {
    full_name: repository,
    url: `https://api.github.com/repos/${repository}`,
    html_url: `https://github.com/${repository}`,
  },
});

/** Every rejection keeps the stable stage message and names the failing check in its code. */
const searchRejection = (code: string): Record<string, unknown> => ({
  name: "GitHubSearchError", message: "GITHUB_SEARCH_REJECTED", code,
});

/** Test-only: overlays mutated query and capacity fields on the signed profile, which the exact parser would reject. */
const signedProfile = parseCrawlProfile(JSON.parse(readFileSync(profilePath, "utf8")));
const profileFrom = (raw: Record<string, any>): CrawlProfile => ({
  ...signedProfile,
  github: { ...signedProfile.github, queries: raw.github.queries },
  capacity: { ...signedProfile.capacity, ...raw.capacity },
}) as CrawlProfile;

describe("GitHub commit search adapter", () => {
  it("binds the exact profile request and returns an immutable candidate", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    Object.assign(raw.capacity, { githubPages: 1, githubResults: 1 });
    const profile = profileFrom(raw);
    const sha = "a".repeat(40);
    const requests: any[] = [];
    const response = {
      total_count: 1, incomplete_results: false,
      documentation_url: "https://docs.github.com/rest/search/search",
      items: [searchItem(sha)],
    };

    const pool = await crawlGitHubCommitSearch({
      profile,
      transport: {
        requestJson: async (request: unknown, page: number) => {
          requests.push({ request, page });
          return response;
        },
      },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });

    expect(requests).toHaveLength(1);
    const requested = new URL(requests[0].request.url);
    expect(requests[0].request).toMatchObject({
      provider: "github",
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": profile.github.apiVersion,
      },
    });
    expect(Object.fromEntries(requested.searchParams)).toEqual({
      q: profile.github.queries[0]!.query,
      sort: "committer-date",
      order: "desc",
      page: "1",
      per_page: "1",
    });
    expect(pool.candidates).toEqual([expect.objectContaining({
      queryId: profile.github.queries[0]!.id,
      queryIndex: 0,
      repository: "example/project",
      commit: sha,
    })]);
    expect(Object.isFrozen(pool)).toBe(true); expect(Object.isFrozen(pool.candidates)).toBe(true);
    expect(Object.isFrozen(pool.candidates[0])).toBe(true);
  });

  it("accepts live-shaped provider supersets and projects only trusted candidate fields", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    raw.capacity.githubPages = 1;
    raw.capacity.githubResults = 1;
    const profile = profileFrom(raw);
    const sha = shaFor(1);
    const response = {
      total_count: 1,
      incomplete_results: false,
      items: [{
        ...searchItem(sha),
        node_id: "MDY6Q29tbWl0MQ==",
        score: 1,
        commit: {
          author: { name: "Example Author", email: "author@example.test" },
          committer: { name: "Example Committer", email: "committer@example.test",
            date: "2026-07-30T10:00:00.000Z" },
          message: "Captured provider response",
          tree: { sha: shaFor(2), url: "https://api.github.com/repos/example/project/git/trees/2" },
          url: "https://api.github.com/repos/example/project/git/commits/1",
        },
        repository: {
          ...(searchItem(sha).repository as Record<string, unknown>),
          id: 1, node_id: "MDEwOlJlcG9zaXRvcnkx", private: false,
          owner: { login: "example", id: 2 },
        },
      }],
    };

    const pool = await crawlGitHubCommitSearch({
      profile,
      transport: { requestJson: async () => response },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });

    expect(pool.candidates).toEqual([{
      queryId: profile.github.queries[0]!.id, queryIndex: 0,
      committerDate: "2026-07-30T10:00:00.000Z",
      repository: "example/project", repositoryUrl: "https://github.com/example/project", commit: sha,
      commitUrl: `https://github.com/example/project/commit/${sha}`,
    }]);
    expect(Object.keys(pool.candidates[0])).toEqual([
      "queryId", "queryIndex", "committerDate", "repository", "repositoryUrl", "commit", "commitUrl",
    ]);
    expect(pool.acceptedResponseHashes).toEqual([canonicalHash(response)]);
  });

  it("crawls every project-controlled query in configured order", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.capacity.githubPages = 1;
    raw.capacity.githubResults = 1;
    const profile = profileFrom(raw);
    const requests: URL[] = [];

    const pool = await crawlGitHubCommitSearch({
      profile,
      transport: {
        requestJson: async (request: { url: string }) => {
          const url = new URL(request.url);
          requests.push(url);
          const queryIndex = profile.github.queries.findIndex(({ query }) =>
            query === url.searchParams.get("q"));
          const sha = `${queryIndex + 1}`.repeat(40);
          return {
            total_count: 1,
            incomplete_results: false,
            items: [{
              sha,
              url: `https://api.github.com/repos/example/project-${queryIndex}/commits/${sha}`,
              html_url: `https://github.com/example/project-${queryIndex}/commit/${sha}`,
              commit: { committer: { date: `2026-07-${10 + queryIndex}T10:00:00Z` } },
              repository: {
                full_name: `example/project-${queryIndex}`,
                url: `https://api.github.com/repos/example/project-${queryIndex}`,
                html_url: `https://github.com/example/project-${queryIndex}`,
              },
            }],
          };
        },
      },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });

    expect(requests.map((url) => url.searchParams.get("q"))).toEqual(
      profile.github.queries.map(({ query }) => query),
    );
    expect(pool.candidates.map(({ queryIndex }: { queryIndex: number }) => queryIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("reads every finite page with the GitHub page size and binds canonical response hashes", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    raw.capacity.githubPages = 2;
    raw.capacity.githubResults = 101;
    const profile = profileFrom(raw);
    const requests: Array<{ request: any; page: number }> = [];
    const responses = [
      {
        total_count: 101,
        incomplete_results: false,
        items: Array.from({ length: 100 }, (_, index) =>
          searchItem(shaFor(index + 1), `example/project-${String(index).padStart(3, "0")}`)),
      },
      {
        total_count: 101,
        incomplete_results: false,
        items: [searchItem(shaFor(101), "example/project-100")],
      },
    ];

    const pool = await crawlGitHubCommitSearch({
      profile,
      transport: {
        requestJson: async (request: unknown, page: number) => {
          requests.push({ request, page });
          return responses[page - 1];
        },
      },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });

    expect(requests.map(({ page }) => page)).toEqual([1, 2]);
    for (const { request, page } of requests) {
      const url = new URL(request.url);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        q: profile.github.queries[0]!.query,
        sort: "committer-date",
        order: "desc",
        page: String(page),
        per_page: "100",
      });
    }
    expect(pool.acceptedResponseHashes).toEqual(responses.map(canonicalHash));
    expect(pool.candidates).toHaveLength(101);
  });

  it("returns a recursively frozen neutral pool in discovery order without path or blob guesses", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    raw.capacity.githubPages = 1;
    raw.capacity.githubResults = 3;
    const profile = profileFrom(raw);
    const older = searchItem(shaFor(3), "example/zeta", "2026-07-29T10:00:00Z");
    const beta = searchItem(shaFor(2), "example/beta", "2026-07-30T10:00:00.001Z");
    const alpha = searchItem(shaFor(1), "example/alpha", "2026-07-30T10:00:00Z");
    const response = { total_count: 3, incomplete_results: false, items: [older, beta, alpha] };

    const pool = await crawlGitHubCommitSearch({
      profile,
      transport: { requestJson: async () => response },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });

    expect(pool).toEqual({
      candidates: [
        {
          queryId: profile.github.queries[0]!.id, queryIndex: 0,
          committerDate: "2026-07-30T10:00:00.001Z",
          repository: "example/beta", repositoryUrl: "https://github.com/example/beta", commit: shaFor(2),
          commitUrl: `https://github.com/example/beta/commit/${shaFor(2)}`,
        },
        {
          queryId: profile.github.queries[0]!.id, queryIndex: 0,
          committerDate: "2026-07-30T10:00:00.000Z",
          repository: "example/alpha", repositoryUrl: "https://github.com/example/alpha", commit: shaFor(1),
          commitUrl: `https://github.com/example/alpha/commit/${shaFor(1)}`,
        },
        {
          queryId: profile.github.queries[0]!.id, queryIndex: 0,
          committerDate: "2026-07-29T10:00:00.000Z",
          repository: "example/zeta", repositoryUrl: "https://github.com/example/zeta", commit: shaFor(3),
          commitUrl: `https://github.com/example/zeta/commit/${shaFor(3)}`,
        },
      ],
      acceptedResponseHashes: [canonicalHash(response)],
      queryClassifications: [{
        queryId: profile.github.queries[0]!.id,
        completeness: "COMPLETE",
      }],
    });
    expect(Object.isFrozen(pool)).toBe(true);
    expect(Object.isFrozen(pool.candidates)).toBe(true);
    expect(Object.isFrozen(pool.candidates[0])).toBe(true);
    expect(Object.keys(pool.candidates[0])).not.toContain("path");
    expect(Object.keys(pool.candidates[0])).not.toContain("blob");
  });

  it("fails closed on incomplete, inconsistent, excessive, or duplicate populations", async () => {
    const base = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    base.github.queries = [base.github.queries[0]];
    const valid = searchItem(shaFor(1));
    const cases = [
      { name: "incomplete outside authorized profile", code: "GITHUB_SEARCH_INCOMPLETE", results: 1, pages: 1,
        response: { total_count: 1, incomplete_results: true, items: [valid] } },
      { name: "over result ceiling", code: "GITHUB_SEARCH_RESULT_CEILING", results: 1, pages: 1,
        response: { total_count: 2, incomplete_results: false, items: [valid] } },
      { name: "missing indexed item", code: "GITHUB_SEARCH_ITEM_COUNT", results: 1, pages: 1,
        response: { total_count: 1, incomplete_results: false, items: [] } },
      { name: "unexpected indexed item", code: "GITHUB_SEARCH_ITEM_COUNT", results: 1, pages: 1,
        response: { total_count: 0, incomplete_results: false, items: [valid] } },
      { name: "duplicate commit", code: "GITHUB_SEARCH_DUPLICATE", results: 2, pages: 1,
        response: { total_count: 2, incomplete_results: false, items: [valid, valid] } },
      {
        name: "over page ceiling",
        code: "GITHUB_SEARCH_PAGE_CEILING",
        results: 101,
        pages: 1,
        response: {
          total_count: 101,
          incomplete_results: false,
          items: Array.from({ length: 100 }, (_, index) =>
            searchItem(shaFor(index + 1), `example/page-${index}`)),
        },
      },
    ];

    for (const scenario of cases) {
      const raw = structuredClone(base);
      raw.capacity.githubResults = scenario.results;
      raw.capacity.githubPages = scenario.pages;
      const profile = profileFrom(raw);
      await expect(crawlGitHubCommitSearch({
        profile,
        transport: { requestJson: async () => scenario.response },
        retry: { execute: async (operation: () => Promise<unknown>) => operation() },
      }), scenario.name).rejects.toMatchObject(searchRejection(scenario.code));
    }
  });

  it("rejects mutable identities, malformed values, and off-host URLs", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    raw.capacity.githubPages = 1;
    raw.capacity.githubResults = 1;
    const profile = profileFrom(raw);
    const mutations: Array<{ name: string; code: string; apply(value: any): void }> = [
      { name: "uppercase sha", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].sha = "A".repeat(40); } },
      { name: "mutable sha", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].sha = "main"; } },
      { name: "invalid repository", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].repository.full_name = "../project"; } },
      { name: "invalid date", code: "GITHUB_SEARCH_DATE", apply: (value) => { value.items[0].commit.committer.date = "yesterday"; } },
      { name: "impossible date", code: "GITHUB_SEARCH_DATE", apply: (value) => { value.items[0].commit.committer.date = "2026-99-99T10:00:00Z"; } },
      { name: "one fractional digit", code: "GITHUB_SEARCH_DATE", apply: (value) => { value.items[0].commit.committer.date = "2026-07-30T10:00:00.0Z"; } },
      { name: "two fractional digits", code: "GITHUB_SEARCH_DATE", apply: (value) => { value.items[0].commit.committer.date = "2026-07-30T10:00:00.00Z"; } },
      { name: "four fractional digits", code: "GITHUB_SEARCH_DATE", apply: (value) => { value.items[0].commit.committer.date = "2026-07-30T10:00:00.0000Z"; } },
      { name: "off-host api commit", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].url = `https://evil.test/commit/${shaFor(1)}`; } },
      { name: "mutable web commit", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].html_url = "https://github.com/example/project/commit/main"; } },
      { name: "off-host api repository", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].repository.url = "https://evil.test/repos/example/project"; } },
      { name: "off-host web repository", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].repository.html_url = "https://evil.test/example/project"; } },
    ];

    for (const mutation of mutations) {
      const response: any = {
        total_count: 1,
        incomplete_results: false,
        items: [searchItem(shaFor(1))],
      };
      mutation.apply(response);
      await expect(crawlGitHubCommitSearch({
        profile,
        transport: { requestJson: async () => response },
        retry: { execute: async (operation: () => Promise<unknown>) => operation() },
      }), mutation.name).rejects.toMatchObject(searchRejection(mutation.code));
    }
  });

  it("retains each canonical accepted-response hash once when valid empty responses repeat", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.capacity.githubPages = 1;
    raw.capacity.githubResults = 1;
    const profile = profileFrom(raw);
    const response = { total_count: 0, incomplete_results: false, items: [] };
    let retryExecutions = 0;

    const pool = await crawlGitHubCommitSearch({
      profile,
      transport: { requestJson: async () => response },
      retry: {
        execute: async (operation: () => Promise<unknown>) => {
          retryExecutions += 1;
          return operation();
        },
      },
    });

    expect(retryExecutions).toBe(profile.github.queries.length);
    expect(pool.candidates).toEqual([]);
    expect(pool.acceptedResponseHashes).toEqual([canonicalHash(response)]);
    expect(Object.isFrozen(pool.acceptedResponseHashes)).toBe(true);
  });

  it("rejects missing required keys, invalid counts, non-array items, and non-string bindings", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    raw.capacity.githubPages = 1;
    raw.capacity.githubResults = 1;
    const profile = profileFrom(raw);
    const mutations: Array<{ name: string; code: string; apply(value: any): void }> = [
      { name: "missing response key", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { delete value.total_count; } },
      { name: "missing item key", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { delete value.items[0].sha; } },
      { name: "missing repository key", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { delete value.items[0].repository.url; } },
      { name: "missing commit key", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { delete value.items[0].commit.committer; } },
      { name: "missing committer key", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { delete value.items[0].commit.committer.date; } },
      { name: "non-array items", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { value.items = {}; } },
      { name: "negative count", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { value.total_count = -1; } },
      { name: "fractional count", code: "GITHUB_SEARCH_SHAPE", apply: (value) => { value.total_count = 0.5; } },
      { name: "non-string sha", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].sha = 1; } },
      { name: "non-string item url", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].url = 1; } },
      { name: "non-string repository", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].repository.full_name = 1; } },
      { name: "non-string repository url", code: "GITHUB_SEARCH_IDENTITY", apply: (value) => { value.items[0].repository.url = 1; } },
      { name: "non-string date", code: "GITHUB_SEARCH_DATE", apply: (value) => { value.items[0].commit.committer.date = 1; } },
    ];

    for (const mutation of mutations) {
      const response: any = {
        total_count: 1,
        incomplete_results: false,
        items: [searchItem(shaFor(1))],
      };
      mutation.apply(response);
      await expect(crawlGitHubCommitSearch({
        profile,
        transport: { requestJson: async () => response },
        retry: { execute: async (operation: () => Promise<unknown>) => operation() },
      }), mutation.name).rejects.toMatchObject(searchRejection(mutation.code));
    }
  });

  it("rejects changing totals and duplicate identities across requests", async () => {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    raw.github.queries = [raw.github.queries[0]];
    raw.capacity.githubPages = 2;
    raw.capacity.githubResults = 101;
    const profile = profileFrom(raw);
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      searchItem(shaFor(index + 1), `example/page-${index}`));
    const inconsistent = crawlGitHubCommitSearch({
      profile,
      transport: {
        requestJson: async (_request: unknown, page: number) => page === 1
          ? { total_count: 101, incomplete_results: false, items: firstPage }
          : { total_count: 100, incomplete_results: false, items: [] },
      },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });
    await expect(inconsistent).rejects.toMatchObject(searchRejection("GITHUB_SEARCH_TOTAL_CHANGED"));

    const repeatedAcrossPages = crawlGitHubCommitSearch({
      profile,
      transport: {
        requestJson: async (_request: unknown, page: number) => ({
          total_count: 101,
          incomplete_results: false,
          items: page === 1 ? firstPage : [firstPage[0]],
        }),
      },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });
    await expect(repeatedAcrossPages).rejects.toMatchObject(searchRejection("GITHUB_SEARCH_DUPLICATE"));

    const allQueries = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
    allQueries.capacity.githubPages = 1;
    allQueries.capacity.githubResults = 1;
    const repeatedAcrossQueries = crawlGitHubCommitSearch({
      profile: profileFrom(allQueries),
      transport: {
        requestJson: async () => ({
          total_count: 1,
          incomplete_results: false,
          items: [searchItem(shaFor(1))],
        }),
      },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });
    await expect(repeatedAcrossQueries).rejects.toMatchObject(searchRejection("GITHUB_SEARCH_DUPLICATE"));
  });

  describe("live retry instructions through the bounded transport", () => {
    const singleQueryProfile = async () => {
      const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
      raw.github.queries = [raw.github.queries[0]];
      Object.assign(raw.capacity, { githubPages: 1, githubResults: 1 });
      return profileFrom(raw);
    };
    const okResponse = () => new Response(JSON.stringify({
      total_count: 1, incomplete_results: false,
      documentation_url: "https://docs.github.com/rest/search/search",
      items: [searchItem("a".repeat(40))],
    }), { status: 200, headers: { "content-type": "application/json" } });
    const liveHarness = (responses: (() => Response)[]) => {
      let fetches = 0;
      const waits: number[] = [];
      const transport = createBoundedTransport({
        limits: { timeoutMilliseconds: 1000, concurrentRequests: 4, requestCount: 200, responseBytes: 8_388_608, pages: 3 },
        credentials: { github: "Bearer external-gh" },
        fetch: async () => { const next = responses[fetches] ?? responses.at(-1)!; fetches += 1; return next(); },
      });
      const retry = createRetryController({ maxRunRetries: 3, maxWaitMilliseconds: 15_000, maxTotalWaitMilliseconds: 30_000,
        sleep: async (milliseconds) => { waits.push(milliseconds); } });
      return { transport, retry, waits, fetches: () => fetches };
    };

    it("retries one page once after a GitHub rate-limit instruction and keeps the run ceilings", async () => {
      const profile = await singleQueryProfile();
      const live = liveHarness([
        () => new Response("limited", { status: 429, headers: { "retry-after": "1" } }),
        okResponse,
      ]);

      const pool = await crawlGitHubCommitSearch({ profile, transport: live.transport, retry: live.retry });

      expect(pool.candidates).toHaveLength(1);
      expect(live.fetches()).toBe(2);
      expect(live.waits).toEqual([1000]);
      expect(live.retry.state()).toEqual({ retries: 1, waitedMilliseconds: 1000 });
    });

    it("fails closed with WAIT_LIMIT on an instruction longer than the signed single wait", async () => {
      const profile = await singleQueryProfile();
      const live = liveHarness([() => new Response(null, { status: 403, headers: { "retry-after": "16" } })]);

      await expect(crawlGitHubCommitSearch({ profile, transport: live.transport, retry: live.retry }))
        .rejects.toMatchObject({ code: "WAIT_LIMIT" });
      expect(live.fetches()).toBe(1);
      expect(live.waits).toEqual([]);
    });

    it("fails with RETRY_SIGNAL_MISSING carrying only the status class when no instruction exists", async () => {
      const profile = await singleQueryProfile();
      const fullUrl = "https://api.github.com/search/commits?q=";
      const live = liveHarness([() => new Response("private-body external-gh", { status: 403 })]);

      let caught: unknown;
      try {
        await crawlGitHubCommitSearch({ profile, transport: live.transport, retry: live.retry });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({ code: "RETRY_SIGNAL_MISSING" });
      expect((caught as Error).cause).toMatchObject({
        code: "UNSUPPORTED_STATUS", diagnostic: { provider: "github", statusClass: "4xx", pathTemplate: "/search/commits" },
      });
      const serialized = JSON.stringify({ error: caught, cause: (caught as Error).cause, message: (caught as Error).message });
      expect(serialized).not.toContain("external-gh");
      expect(serialized).not.toContain("private-body");
      expect(serialized).not.toContain(fullUrl);
      expect(serialized).not.toContain(profile.github.queries[0]!.query);
      expect(live.fetches()).toBe(1);
    });
  });
});
