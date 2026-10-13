import { canonicalHash } from "./canonical";
import type { CrawlProfile } from "./profile";
import type { RetryController } from "./retry";
import type { BoundedTransport } from "./transport";

const SEARCH_ENDPOINT = "https://api.github.com/search/commits";
const GITHUB_PAGE_SIZE = 100;
const COMMITTER_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/u;
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;
const MAXIMUM_OFFSET_HOUR = 14;
const MAXIMUM_CLOCK_HOUR = 23;
const MAXIMUM_MINUTE_OR_SECOND = 59;
const MAXIMUM_UTC_YEAR = 9999;
const LEAP_YEAR_INTERVAL = 4;
const LEAP_YEAR_CENTURY = 100;
const LEAP_YEAR_CYCLE = 400;
const FEBRUARY = 2;

type UnknownRecord = Record<string, unknown>;

/** The discovery check that rejected a response; the stage log names it instead of the generic message. */
export type GitHubSearchRejection =
  | "GITHUB_SEARCH_SHAPE"
  | "GITHUB_SEARCH_IDENTITY"
  | "GITHUB_SEARCH_DATE"
  | "GITHUB_SEARCH_INCOMPLETE"
  | "GITHUB_SEARCH_RESULT_CEILING"
  | "GITHUB_SEARCH_TOTAL_CHANGED"
  | "GITHUB_SEARCH_PAGE_CEILING"
  | "GITHUB_SEARCH_ITEM_COUNT"
  | "GITHUB_SEARCH_DUPLICATE";

export class GitHubSearchError extends Error {
  public constructor(public readonly code: GitHubSearchRejection) {
    super("GITHUB_SEARCH_REJECTED");
    this.name = "GitHubSearchError";
  }
}

export interface GitHubSearchOptions {
  readonly profile: CrawlProfile;
  readonly transport: Pick<BoundedTransport, "requestJson">;
  readonly retry: Pick<RetryController, "execute">;
  /** Called before a query's one fresh pass, so the caller can forget the discarded pass's pages. */
  readonly onQueryRestart?: (queryId: string) => void;
}

export interface GitHubSearchCandidate {
  readonly queryId: string;
  readonly queryIndex: number;
  readonly committerDate: string;
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly commit: string;
  readonly commitUrl: string;
}

export interface GitHubSearchPool {
  readonly candidates: readonly GitHubSearchCandidate[];
  readonly acceptedResponseHashes: readonly string[];
  readonly queryClassifications: readonly GitHubQueryClassification[];
}

export type GitHubQueryCompleteness = "COMPLETE" | "PROVIDER_REPORTED_INCOMPLETE";

export interface GitHubQueryClassification {
  readonly queryId: string;
  readonly completeness: GitHubQueryCompleteness;
}

const fail = (code: GitHubSearchRejection): never => { throw new GitHubSearchError(code); };
const requiredRecord = (value: unknown, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("GITHUB_SEARCH_SHAPE");
  const candidate = value as UnknownRecord;
  if (keys.some((key) => !Object.hasOwn(candidate, key))) fail("GITHUB_SEARCH_SHAPE");
  return candidate;
};

const searchResponse = (value: unknown): Readonly<{
  totalCount: number;
  incompleteResults: boolean;
  items: readonly UnknownRecord[];
}> => {
  const response = requiredRecord(value, ["total_count", "incomplete_results", "items"]);
  const items = response.items;
  if (!Number.isSafeInteger(response.total_count) || (response.total_count as number) < 0) fail("GITHUB_SEARCH_SHAPE");
  if (typeof response.incomplete_results !== "boolean") fail("GITHUB_SEARCH_SHAPE");
  const parsedItems: unknown[] = Array.isArray(items) ? items : fail("GITHUB_SEARCH_SHAPE");
  return Object.freeze({
    totalCount: response.total_count as number,
    incompleteResults: response.incomplete_results as boolean,
    items: parsedItems.map((item: unknown) => requiredRecord(item, [
      "sha", "url", "html_url", "commit", "repository",
    ])),
  });
};

const repositoryName = (value: unknown): string => {
  if (typeof value !== "string") return fail("GITHUB_SEARCH_IDENTITY");
  const segments = value.split("/");
  if (segments.length !== 2 || segments.some((segment) =>
    segment.length === 0
    || segment === "."
    || segment === ".."
    || !/^[A-Za-z0-9_.-]+$/u.test(segment))) fail("GITHUB_SEARCH_IDENTITY");
  return value;
};

const fullCommit = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) ? value : fail("GITHUB_SEARCH_IDENTITY");

const isLeapYear = (year: number): boolean =>
  year % LEAP_YEAR_INTERVAL === 0
  && (year % LEAP_YEAR_CENTURY !== 0 || year % LEAP_YEAR_CYCLE === 0);

const daysInMonth = (year: number, month: number): number => {
  const length = MONTH_LENGTHS[month - 1];
  if (length === undefined) return 0;
  return month === FEBRUARY && isLeapYear(year) ? length + 1 : length;
};

const committerDate = (value: unknown): string => {
  const match = typeof value === "string" ? COMMITTER_DATE.exec(value) : null;
  if (match === null) return fail("GITHUB_SEARCH_DATE");
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = Number(match[6]!);
  const millisecond = Number(match[7] ?? "000");
  const offsetHour = Number(match[9] ?? "00");
  const offsetMinute = Number(match[10] ?? "00");
  if (month < 1 || month > MONTH_LENGTHS.length || day < 1 || day > daysInMonth(year, month)
    || hour > MAXIMUM_CLOCK_HOUR || minute > MAXIMUM_MINUTE_OR_SECOND
    || second > MAXIMUM_MINUTE_OR_SECOND || offsetHour > MAXIMUM_OFFSET_HOUR
    || offsetMinute > MAXIMUM_MINUTE_OR_SECOND
    || (offsetHour === MAXIMUM_OFFSET_HOUR && offsetMinute !== 0)
    || (match[8] === "-" && offsetHour === 0 && offsetMinute === 0)) return fail("GITHUB_SEARCH_DATE");
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  const direction = match[8] === "-" ? -1 : 1;
  const offset = direction * ((offsetHour * MINUTES_PER_HOUR) + offsetMinute);
  const normalized = new Date(local.getTime() - (offset * MILLISECONDS_PER_MINUTE));
  if (!Number.isFinite(normalized.getTime())
    || normalized.getUTCFullYear() < 0 || normalized.getUTCFullYear() > MAXIMUM_UTC_YEAR) return fail("GITHUB_SEARCH_DATE");
  return normalized.toISOString();
};

const parseCandidate = (
  item: UnknownRecord,
  queryId: string,
  queryIndex: number,
): GitHubSearchCandidate => {
  const repository = requiredRecord(item.repository, ["full_name", "url", "html_url"]);
  const commitRecord = requiredRecord(item.commit, ["committer"]);
  const committer = requiredRecord(commitRecord.committer, ["date"]);
  const repositoryIdentity = repositoryName(repository.full_name);
  const commit = fullCommit(item.sha);
  const apiRepositoryUrl = `https://api.github.com/repos/${repositoryIdentity}`;
  const repositoryUrl = `https://github.com/${repositoryIdentity}`;
  const apiCommitUrl = `${apiRepositoryUrl}/commits/${commit}`;
  const commitUrl = `${repositoryUrl}/commit/${commit}`;
  if (repository.url !== apiRepositoryUrl
    || repository.html_url !== repositoryUrl
    || item.url !== apiCommitUrl
    || item.html_url !== commitUrl) fail("GITHUB_SEARCH_IDENTITY");
  return Object.freeze({
    queryId,
    queryIndex,
    committerDate: committerDate(committer.date),
    repository: repositoryIdentity,
    repositoryUrl,
    commit,
    commitUrl,
  });
};

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const discoveryOrder = (left: GitHubSearchCandidate, right: GitHubSearchCandidate): number =>
  left.queryIndex - right.queryIndex
  || Date.parse(right.committerDate) - Date.parse(left.committerDate)
  || compareText(left.repository, right.repository)
  || compareText(left.commit, right.commit);

const loadSearchPage = (
  options: GitHubSearchOptions,
  query: CrawlProfile["github"]["queries"][number],
  page: number,
  perPage: number,
): Promise<unknown> => {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query.query);
  url.searchParams.set("sort", query.sort);
  url.searchParams.set("order", query.order);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  return options.retry.execute(() => options.transport.requestJson({
    provider: "github",
    method: "GET",
    url: url.href,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": options.profile.github.apiVersion,
    },
  }, page));
};

/** Provider inconsistencies that one fresh pass over the same query can clear; record drift is never retried. */
const RECRAWLED_REJECTIONS: ReadonlySet<GitHubSearchRejection> = new Set([
  "GITHUB_SEARCH_INCOMPLETE", "GITHUB_SEARCH_TOTAL_CHANGED", "GITHUB_SEARCH_ITEM_COUNT", "GITHUB_SEARCH_DUPLICATE",
] as const);

interface QueryPass {
  readonly candidates: readonly GitHubSearchCandidate[];
  readonly responses: readonly unknown[];
}

const identityOf = (candidate: GitHubSearchCandidate): string => `${candidate.repository}\0${candidate.commit}`;

/** One complete, consistent pass over every page of a query, or a rejection naming the failed check. */
const crawlQuery = async (
  options: GitHubSearchOptions,
  query: CrawlProfile["github"]["queries"][number],
  queryIndex: number,
  earlierQueries: ReadonlySet<string>,
): Promise<QueryPass> => {
  const perPage = Math.min(GITHUB_PAGE_SIZE, options.profile.capacity.githubResults);
  const candidates: GitHubSearchCandidate[] = [];
  const responses: unknown[] = [];
  const seen = new Set<string>();
  let pages = 1;
  let expectedTotal: number | undefined;
  for (let page = 1; page <= pages; page += 1) {
    const response = await loadSearchPage(options, query, page, perPage);
    const parsed = searchResponse(response);
    if (parsed.incompleteResults) fail("GITHUB_SEARCH_INCOMPLETE");
    if (parsed.totalCount > options.profile.capacity.githubResults) fail("GITHUB_SEARCH_RESULT_CEILING");
    if (expectedTotal !== undefined && parsed.totalCount !== expectedTotal) fail("GITHUB_SEARCH_TOTAL_CHANGED");
    expectedTotal = parsed.totalCount;
    pages = Math.max(1, Math.ceil(parsed.totalCount / perPage));
    if (pages > options.profile.capacity.githubPages) fail("GITHUB_SEARCH_PAGE_CEILING");
    const remaining = Math.max(0, parsed.totalCount - ((page - 1) * perPage));
    if (parsed.items.length !== Math.min(perPage, remaining)) fail("GITHUB_SEARCH_ITEM_COUNT");
    responses.push(response);
    for (const item of parsed.items) {
      const candidate = parseCandidate(item, query.id, queryIndex);
      const identity = identityOf(candidate);
      if (seen.has(identity) || earlierQueries.has(identity)) fail("GITHUB_SEARCH_DUPLICATE");
      seen.add(identity);
      candidates.push(candidate);
    }
  }
  return Object.freeze({ candidates, responses });
};

export const crawlGitHubCommitSearch = async (
  options: GitHubSearchOptions,
): Promise<GitHubSearchPool> => {
  const candidates: GitHubSearchCandidate[] = [];
  const acceptedResponseHashes: string[] = [];
  const queryClassifications: GitHubQueryClassification[] = [];
  const seenResponseHashes = new Set<string>();
  const seenCandidates = new Set<string>();
  for (const [queryIndex, query] of options.profile.github.queries.entries()) {
    let pass: QueryPass;
    try {
      pass = await crawlQuery(options, query, queryIndex, seenCandidates);
    } catch (error) {
      if (!(error instanceof GitHubSearchError) || !RECRAWLED_REJECTIONS.has(error.code)) throw error;
      // One fresh pass: a transient inconsistency clears, a real one fails the same way again.
      options.onQueryRestart?.(query.id);
      pass = await crawlQuery(options, query, queryIndex, seenCandidates);
    }
    for (const response of pass.responses) {
      const responseHash = canonicalHash(response);
      if (!seenResponseHashes.has(responseHash)) {
        seenResponseHashes.add(responseHash);
        acceptedResponseHashes.push(responseHash);
      }
    }
    for (const candidate of pass.candidates) seenCandidates.add(identityOf(candidate));
    candidates.push(...pass.candidates);
    queryClassifications.push(Object.freeze({ queryId: query.id, completeness: "COMPLETE" }));
  }
  return Object.freeze({
    candidates: Object.freeze(candidates.sort(discoveryOrder)),
    acceptedResponseHashes: Object.freeze(acceptedResponseHashes),
    queryClassifications: Object.freeze(queryClassifications),
  });
};
